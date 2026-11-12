"""Index LF1's existing four-field photo document into managed OpenSearch.

Add to backend/index_photos/lambda_function.py:
  from opensearch_writer import index_photo_document
and immediately after building/logging the `document`:
  index_photo_document(document)

P1 must package this helper next to lambda_function.py in the same ZIP.
"""
import hashlib
import json
import logging
import os
from urllib.request import Request, urlopen

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

LOGGER = logging.getLogger(__name__)


def index_photo_document(document):
    endpoint = os.environ["OPENSEARCH_ENDPOINT"].rstrip("/")
    if not endpoint.startswith("https://"):
        raise ValueError("OPENSEARCH_ENDPOINT must begin with https://")

    bucket = document["bucket"]
    key = document["objectKey"]
    document_id = hashlib.sha256(f"{bucket}/{key}".encode("utf-8")).hexdigest()
    index = os.environ.get("OPENSEARCH_INDEX", "photos")
    url = f"{endpoint}/{index}/_doc/{document_id}"
    region = os.environ.get("AWS_REGION", "us-east-1")
    body = json.dumps(document, separators=(",", ":")).encode("utf-8")

    session = boto3.Session(region_name=region)
    creds = session.get_credentials()
    if creds is None:
        raise RuntimeError("LF1 could not find AWS role credentials")
    signed = AWSRequest(method="PUT", url=url, data=body, headers={"Content-Type": "application/json"})
    SigV4Auth(creds.get_frozen_credentials(), "es", region).add_auth(signed)
    req = Request(url, data=body, headers=dict(signed.headers.items()), method="PUT")
    with urlopen(req, timeout=10) as response:
        LOGGER.info("OpenSearch indexed %s/%s (HTTP %s)", bucket, key, response.status)
