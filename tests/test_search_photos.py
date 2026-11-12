"""Unit tests that do not call AWS; run via python -m unittest discover -s tests."""
import importlib.util
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "backend" / "search_photos" / "lambda_function.py"
SPEC = importlib.util.spec_from_file_location("lf2", MODULE)
lf2 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lf2)


class SearchPhotosTests(unittest.TestCase):
    def test_empty_q_needs_no_services(self):
        self.assertEqual(json.loads(lf2.lambda_handler({"queryStringParameters": None}, None)["body"]),
                         {"results": []})

    def test_lex_slots_and_duplicate(self):
        lex_response = {"sessionState": {"intent": {
            "name": "SearchIntent", "slots": {
                "KeywordOne": {"value": {"interpretedValue": " Dogs "}},
                "KeywordTwo": {"value": {"interpretedValue": "dogs"}},
            }
        }}}
        self.assertEqual(lf2.extract_keywords(lex_response), ["Dogs"])

    def test_null_and_wrong_intent(self):
        self.assertEqual(lf2.extract_keywords({"sessionState": {"intent": {
            "name": "SearchIntent", "slots": {"KeywordOne": None}
        }}}), [])
        self.assertEqual(lf2.extract_keywords({"sessionState": {"intent": {
            "name": "FallbackIntent", "slots": {"KeywordOne": {"value": {"interpretedValue": "dogs"}}}
        }}}), [])

    def test_two_keywords_use_or_matching(self):
        query = lf2.build_search_query(["cats", "dogs"])
        self.assertEqual(query["query"]["bool"]["should"], [
            {"match": {"labels": {"query": "cats", "operator": "and"}}},
            {"match": {"labels": {"query": "dogs", "operator": "and"}}},
        ])
        self.assertEqual(query["query"]["bool"]["minimum_should_match"], 1)
        self.assertNotIn("must", query["query"]["bool"])

    def test_single_keyword_uses_same_or_query(self):
        query = lf2.build_search_query(["tierlist"])
        self.assertEqual(len(query["query"]["bool"]["should"]), 1)
        self.assertEqual(query["query"]["bool"]["minimum_should_match"], 1)

    def test_explicit_and_or_keywords(self):
        cases = {
            "tierlist": ["tierlist"],
            "tierlist and fran": ["tierlist", "fran"],
            "tierlist or fran": ["tierlist", "fran"],
            "person AND tierlist": ["person", "tierlist"],
            "show me photos of dogs and cats": ["dogs", "cats"],
            "show me photos of dogs or cats": ["dogs", "cats"],
            "show me photos of tierlist": ["tierlist"],
        }
        for query, expected in cases.items():
            with self.subTest(query=query):
                self.assertEqual(lf2.parse_explicit_keywords(query), expected)

    def test_explicit_two_keywords_override_incomplete_lex(self):
        self.assertEqual(lf2.resolve_keywords("tierlist or fran", ["fran"]), ["tierlist", "fran"])
        self.assertEqual(lf2.resolve_keywords("dogs and cats", ["dogs"]), ["dogs", "cats"])
        self.assertEqual(lf2.resolve_keywords("tierlist and fran", []), ["tierlist", "fran"])
        self.assertEqual(lf2.resolve_keywords("tierlist", []), ["tierlist"])

    def test_missing_configuration_is_explicit(self):
        with patch.dict(os.environ, {}, clear=True):
            response = lf2.lambda_handler({"queryStringParameters": {"q": "dogs"}}, None)
        self.assertEqual(response["statusCode"], 503)

    def test_full_contract_with_fake_backends(self):
        environment = {
            "LEX_BOT_ID": "TESTBOT", "LEX_BOT_ALIAS_ID": "TESTALIAS",
            "OPENSEARCH_ENDPOINT": "https://test.us-east-1.es.amazonaws.com",
            "PHOTOS_BUCKET": "my-bucket",
        }
        with patch.dict(os.environ, environment), \
             patch.object(lf2, "_recognize_keywords", return_value=["cats", "dogs"]), \
             patch.object(lf2, "_query_opensearch", return_value=[
                 {"_source": {"bucket": "my-bucket", "objectKey": "catdog.jpg",
                              "labels": ["Cat", "Dog"]}},
                 {"_source": {"bucket": "my-bucket", "objectKey": "catdog.jpg",
                              "labels": ["Cat", "Dog"]}},
             ]), \
             patch.object(lf2, "_presign_photo", return_value="https://example.test/presigned"):
            response = lf2.lambda_handler({"queryStringParameters": {"q": "show me cats and dogs"}}, None)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(json.loads(response["body"]), {"results": [
            {"url": "https://example.test/presigned", "labels": ["Cat", "Dog"]}
        ]})


if __name__ == "__main__":
    unittest.main()
