"""Memory Lane LF2 - API Gateway GET /search -> Lex V2 -> OpenSearch -> S3 URLs.

Uses the contract in MEMORY_LANE_TEAM_HANDOFF.md. No OpenSearch/third-party
client dependency: AWS Lambda's built-in boto3 + botocore and Python stdlib.
"""

import json
import logging
import os
import uuid
from urllib.request import Request, urlopen

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.config import Config

LOG = logging.getLogger(__name__)
LOG.setLevel(logging.INFO)
REGION = os.environ.get("AWS_REGION", "us-east-1")
SEARCH_PAGE_SIZE = 100
# OpenSearch's usual default maximum result window. For larger data sets,
# switch to search_after/pagination instead of silently omitting results.
MAX_SEARCH_WINDOW = 10000


def _response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": os.environ.get("CORS_ALLOW_ORIGIN", "*"),
            "Access-Control-Allow-Headers": "Content-Type,x-api-key",
            "Access-Control-Allow-Methods": "GET,OPTIONS",
        },
        "body": json.dumps(body),
    }


def extract_keywords(lex_response):
    """Parse the agreed Lex V2 SearchIntent scalar slots, no keyword guessing."""
    state = lex_response.get("sessionState") or {}
    intent = state.get("intent") or {}
    if intent.get("name") != "SearchIntent":
        return []
    if intent.get("state") == "Failed" or intent.get("confirmationState") == "Denied":
        return []

    slots = intent.get("slots") or {}
    output, seen = [], set()
    for name in ("KeywordOne", "KeywordTwo"):
        slot = slots.get(name)
        if not isinstance(slot, dict):
            continue
        value = slot.get("value") or {}
        raw = value.get("interpretedValue") or value.get("originalValue")
        if not isinstance(raw, str):
            continue
        keyword = raw.strip()
        if keyword and keyword.casefold() not in seen:
            output.append(keyword)
            seen.add(keyword.casefold())
    return output


def _recognize_keywords(query):
    lex = boto3.client("lexv2-runtime", region_name=REGION)
    lex_response = lex.recognize_text(
        botId=os.environ["LEX_BOT_ID"],
        botAliasId=os.environ["LEX_BOT_ALIAS_ID"],
        localeId=os.environ.get("LEX_LOCALE_ID", "en_US"),
        sessionId=uuid.uuid4().hex,
        text=query,
    )
    return extract_keywords(lex_response)


def build_search_query(keywords, offset=0):
    """Match ALL Lex-extracted terms against the labels text field."""
    return {
        "query": {
            "bool": {
                "must": [
                    {"match": {"labels": {"query": term, "operator": "and"}}}
                    for term in keywords
                ]
            }
        },
        "from": offset,
        "size": SEARCH_PAGE_SIZE,
        "sort": [{"bucket": "asc"}, {"objectKey": "asc"}],
    }


def _signed_opensearch_post(payload):
    """Send a SigV4-signed OpenSearch data-plane POST (service name 'es')."""
    endpoint = os.environ["OPENSEARCH_ENDPOINT"].rstrip("/")
    index = os.environ.get("OPENSEARCH_INDEX", "photos")
    url = f"{endpoint}/{index}/_search"
    data = json.dumps(payload, separators=(",", ":")).encode("utf-8")

    session = boto3.Session(region_name=REGION)
    credentials = session.get_credentials()
    if credentials is None:
        raise RuntimeError("AWS credentials unavailable to LF2")
    credentials = credentials.get_frozen_credentials()

    signed_request = AWSRequest(
        method="POST", url=url, data=data,
        headers={"Content-Type": "application/json"},
    )
    SigV4Auth(credentials, "es", REGION).add_auth(signed_request)
    request = Request(
        url=url,
        data=data,
        headers=dict(signed_request.headers.items()),
        method="POST",
    )
    with urlopen(request, timeout=8) as response:
        return json.loads(response.read().decode("utf-8"))


def _query_opensearch(keywords):
    """Read all hits up to the managed index's default 10k result window."""
    hits = []
    offset = 0
    while True:
        response = _signed_opensearch_post(build_search_query(keywords, offset))
        data = response["hits"]
        page = data.get("hits", [])
        hits.extend(page)
        total = data.get("total", 0)
        total_count = total.get("value", 0) if isinstance(total, dict) else total
        offset += len(page)
        if not page or offset >= total_count:
            break
        if offset >= MAX_SEARCH_WINDOW:
            raise RuntimeError("More search results than the default OpenSearch window")
    return hits


def _presign_photo(bucket, key):
    s3 = boto3.client("s3", region_name=REGION,
                      config=Config(signature_version="s3v4"))
    ttl = max(60, min(3600, int(os.environ.get("S3_PRESIGN_TTL_SECONDS", "900"))))
    return s3.generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=ttl
    )


def lambda_handler(event, context):
    params = event.get("queryStringParameters") or {}
    q = params.get("q") or ""
    if not isinstance(q, str) or not q.strip():
        return _response(200, {"results": []})
    q = q.strip()
    if len(q) > 1024:
        return _response(400, {"code": 400, "message": "Query is too long"})

    required = ("LEX_BOT_ID", "LEX_BOT_ALIAS_ID", "OPENSEARCH_ENDPOINT", "PHOTOS_BUCKET")
    if any(not os.environ.get(name) for name in required):
        return _response(503, {"code": 503, "message": "Search service not configured"})

    try:
        keywords = _recognize_keywords(q)
        if not keywords:
            return _response(200, {"results": []})

        seen, results = set(), []
        for hit in _query_opensearch(keywords):
            source = hit.get("_source") or {}
            bucket = source.get("bucket")
            key = source.get("objectKey")
            labels = source.get("labels")
            if (bucket != os.environ["PHOTOS_BUCKET"] or not isinstance(key, str)
                    or not key or not isinstance(labels, list)
                    or not all(isinstance(label, str) for label in labels)):
                continue
            ident = (bucket, key)
            if ident in seen:
                continue
            seen.add(ident)
            results.append({"url": _presign_photo(bucket, key), "labels": labels})
        return _response(200, {"results": results})
    except Exception:
        # Never expose upstream AWS or domain error details to the browser.
        LOG.exception("LF2 search failed")
        return _response(502, {"code": 502, "message": "Search temporarily unavailable"})
