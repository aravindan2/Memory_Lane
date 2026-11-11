
"""Write photo metadata documents to Amazon OpenSearch."""

import hashlib
import json
import logging
import os

from urllib.error import HTTPError
from urllib.request import Request, urlopen

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest


logger = logging.getLogger(__name__)


def index_photo_document(document):
    # 1. Get OpenSearch configuration.
    endpoint = os.environ["OPENSEARCH_ENDPOINT"].rstrip("/")
    index = os.environ.get("OPENSEARCH_INDEX", "photos")
    region = os.environ.get("AWS_REGION", "us-east-1")

    if not endpoint.startswith("https://"):
        raise ValueError(
            "OPENSEARCH_ENDPOINT must begin with https://"
        )

    # 2. Create a deterministic document ID.
    bucket = document["bucket"]
    key = document["objectKey"]

    document_id = hashlib.sha256(
        f"{bucket}/{key}".encode("utf-8")
    ).hexdigest()

    url = f"{endpoint}/{index}/_doc/{document_id}"

    # 3. Serialize the photo document.
    body = json.dumps(
        document,
        separators=(",", ":")
    ).encode("utf-8")

    # 4. Retrieve Lambda IAM credentials.
    session = boto3.Session(region_name=region)
    credentials = session.get_credentials()

    if credentials is None:
        raise RuntimeError(
            "LF1 could not find AWS role credentials"
        )

    # 5. Sign the request using AWS Signature V4.
    signed_request = AWSRequest(
        method="PUT",
        url=url,
        data=body,
        headers={
            "Content-Type": "application/json"
        }
    )

    SigV4Auth(
        credentials.get_frozen_credentials(),
        "es",
        region
    ).add_auth(signed_request)

    request = Request(
        url,
        data=body,
        headers=dict(signed_request.headers.items()),
        method="PUT"
    )

    # 6. Send the document to OpenSearch.
    try:
        with urlopen(request, timeout=10) as response:
            logger.info(
                "OpenSearch indexed %s/%s (HTTP %s)",
                bucket,
                key,
                response.status
            )

            return response.status

    except HTTPError as error:
        # Read the actual OpenSearch error response.
        detail = error.read().decode(
            "utf-8",
            errors="replace"
        )

        logger.error(
            "OpenSearch rejected index request for "
            "%s/%s: HTTP %s, body: %s",
            bucket,
            key,
            error.code,
            detail[:3000]
        )

        raise RuntimeError(
            f"OpenSearch HTTP {error.code}: "
            f"{detail[:2000]}"
        ) from error
