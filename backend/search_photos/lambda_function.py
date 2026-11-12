"""Memory Lane LF2: interpret photo searches with Lex, search OpenSearch, return S3 URLs."""

import json
import logging
import os
import re
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.config import Config

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
REGION = os.environ.get("AWS_REGION", "us-east-1")
SEARCH_PAGE_SIZE = 100
MAX_SEARCH_WINDOW = 10000

# Supported natural-language search prefixes. The remaining words are labels.
_SEARCH_PREFIX = re.compile(
    r"^(?:please\s+)?(?:"
    r"(?:show\s+me|find(?:\s+me)?|search\s+for)"
    r"(?:\s+(?:all\s+)?(?:photos?|pictures?|images?))?"
    r"(?:\s+(?:of|with|containing|tagged\s+with))?"
    r"|(?:all\s+)?(?:photos?|pictures?|images?)"
    r"\s+(?:of|with|containing)"
    r")\s+",
    re.IGNORECASE,
)


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": os.environ.get("CORS_ALLOW_ORIGIN", "*"),
            "Access-Control-Allow-Headers": "Content-Type,x-api-key",
            "Access-Control-Allow-Methods": "GET,OPTIONS",
        },
        "body": json.dumps(body),
    }


def extract_keywords(lex_response):
    """Read the two optional slots from a recognized Lex SearchIntent."""
    intent = (lex_response.get("sessionState") or {}).get("intent") or {}
    if intent.get("name") != "SearchIntent":
        return []
    if intent.get("state") == "Failed" or intent.get("confirmationState") == "Denied":
        return []

    slots = intent.get("slots") or {}
    keywords = []
    seen = set()
    for slot_name in ("KeywordOne", "KeywordTwo"):
        slot = slots.get(slot_name)
        if not isinstance(slot, dict):
            continue
        value = slot.get("value") or {}
        term = value.get("interpretedValue") or value.get("originalValue")
        if not isinstance(term, str):
            continue
        term = term.strip()
        if term and term.casefold() not in seen:
            seen.add(term.casefold())
            keywords.append(term)
    return keywords


def parse_explicit_keywords(query):
    """Parse straightforward one/two-label queries when Lex omits slots.

    Examples:
      tierlist                            -> [tierlist]
      person and tierlist                 -> [person, tierlist]
      tierlist or fran                    -> [tierlist, fran]
      show me photos of person and tierlist -> [person, tierlist]
      show me dogs                        -> [dogs]

    Unrecognized full questions are left for Lex rather than guessed as tags.
    """
    if not isinstance(query, str):
        return []

    text = query.strip().strip(" .!?\"'")
    if not text or len(text) > 160:
        return []

    prefix = _SEARCH_PREFIX.match(text)
    if prefix:
        text = text[prefix.end():].strip()
    elif re.match(r"^(?:who|what|when|where|why|how)\b", text, re.IGNORECASE):
        return []

    terms = re.split(r"\s+(?:and|or)\s+", text, flags=re.IGNORECASE)
    if len(terms) > 2:
        return []

    keywords = []
    for term in terms:
        term = term.strip().strip(" .!?\"'")
        if not term or len(term) > 80 or any(c in term for c in "\r\n\t"):
            return []
        # Direct labels can contain spaces, but do not interpret long prose as a label.
        if len(term.split()) > 5:
            return []
        if term.casefold() not in [existing.casefold() for existing in keywords]:
            keywords.append(term)
    return keywords


def resolve_keywords(query, lex_keywords):
    """Use explicit two-label queries; otherwise retain Lex with fallback."""
    explicit = parse_explicit_keywords(query)

    # Lex may omit one or both slots for custom labels and OR phrases.
    # An unambiguous two-label query is more reliable than Lex slots.
    if len(explicit) == 2:
        return explicit

    # A bare custom label can yield SearchIntent with both slots empty.
    if not lex_keywords:
        return explicit

    return lex_keywords


def _recognize_keywords(query):
    lex = boto3.client("lexv2-runtime", region_name=REGION)
    response = lex.recognize_text(
        botId=os.environ["LEX_BOT_ID"],
        botAliasId=os.environ["LEX_BOT_ALIAS_ID"],
        localeId=os.environ.get("LEX_LOCALE_ID", "en_US"),
        sessionId=uuid.uuid4().hex,
        text=query,
    )
    return extract_keywords(response)


def build_search_query(keywords, offset=0):
    """OR across labels; keep all terms of a multiword label together."""
    return {
        "query": {
            "bool": {
                "should": [
                    {"match": {"labels": {"query": keyword, "operator": "and"}}}
                    for keyword in keywords
                ],
                "minimum_should_match": 1,
            }
        },
        "from": offset,
        "size": SEARCH_PAGE_SIZE,
        "sort": [{"bucket": "asc"}, {"objectKey": "asc"}],
    }


def _signed_opensearch_post(payload):
    endpoint = os.environ["OPENSEARCH_ENDPOINT"].rstrip("/")
    index = os.environ.get("OPENSEARCH_INDEX", "photos")
    url = f"{endpoint}/{index}/_search"
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")

    credentials = boto3.Session(region_name=REGION).get_credentials()
    if credentials is None:
        raise RuntimeError("LF2 has no AWS role credentials")

    signed = AWSRequest(
        method="POST",
        url=url,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    SigV4Auth(credentials.get_frozen_credentials(), "es", REGION).add_auth(signed)
    request = Request(
        url,
        data=body,
        headers=dict(signed.headers.items()),
        method="POST",
    )
    try:
        with urlopen(request, timeout=8) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        LOGGER.error("OpenSearch search HTTP %s: %s", error.code, detail[:2000])
        raise


def _query_opensearch(keywords):
    hits = []
    offset = 0
    while True:
        response = _signed_opensearch_post(build_search_query(keywords, offset))
        page = (response.get("hits") or {}).get("hits", [])
        hits.extend(page)
        offset += len(page)
        if len(page) < SEARCH_PAGE_SIZE:
            return hits
        if offset >= MAX_SEARCH_WINDOW:
            raise RuntimeError("Search results exceed OpenSearch's result window")


def _presign_photo(bucket, key):
    ttl = max(60, min(3600, int(os.environ.get("S3_PRESIGN_TTL_SECONDS", "900"))))
    s3 = boto3.client(
        "s3", region_name=REGION, config=Config(signature_version="s3v4")
    )
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=ttl,
    )


def lambda_handler(event, context):
    params = event.get("queryStringParameters") or {}
    query = params.get("q") or ""
    if not isinstance(query, str) or not query.strip():
        return _response(200, {"results": []})
    query = query.strip()
    if len(query) > 1024:
        return _response(400, {"code": 400, "message": "Query is too long"})

    required = ("LEX_BOT_ID", "LEX_BOT_ALIAS_ID", "OPENSEARCH_ENDPOINT", "PHOTOS_BUCKET")
    if any(not os.environ.get(name) for name in required):
        return _response(503, {"code": 503, "message": "Search service not configured"})

    try:
        lex_keywords = _recognize_keywords(query)
        keywords = resolve_keywords(query, lex_keywords)
        LOGGER.info("Search keywords: %s", keywords)
        if not keywords:
            return _response(200, {"results": []})

        results = []
        seen = set()
        for hit in _query_opensearch(keywords):
            source = hit.get("_source") or {}
            bucket = source.get("bucket")
            key = source.get("objectKey")
            labels = source.get("labels")
            if (
                bucket != os.environ["PHOTOS_BUCKET"]
                or not isinstance(key, str)
                or not key
                or not isinstance(labels, list)
                or not all(isinstance(label, str) for label in labels)
            ):
                continue
            identity = (bucket, key)
            if identity in seen:
                continue
            seen.add(identity)
            results.append({"url": _presign_photo(bucket, key), "labels": labels})

        return _response(200, {"results": results})
    except Exception:
        LOGGER.exception("LF2 search failed")
        return _response(502, {"code": 502, "message": "Search temporarily unavailable"})
