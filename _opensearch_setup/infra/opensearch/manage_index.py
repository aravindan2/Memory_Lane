"""One-time OpenSearch index creation/inspection with AWS IAM SigV4.

Commands (PowerShell from repo root):
  $env:OPENSEARCH_ENDPOINT = 'https://search-photos-...us-east-1.es.amazonaws.com'
  python .\infra\opensearch\manage_index.py create
  python .\infra\opensearch\manage_index.py mapping
  python .\infra\opensearch\manage_index.py count

Requires boto3/botocore and an AWS principal authorized by domain and IAM policies.
"""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

REGION = os.environ.get("AWS_REGION", "us-east-1")
INDEX = os.environ.get("OPENSEARCH_INDEX", "photos")
MAPPING_PATH = pathlib.Path(__file__).with_name("photos_mapping.json")


def signed_request(method, path, payload=None):
    endpoint = os.environ.get("OPENSEARCH_ENDPOINT", "").rstrip("/")
    if not endpoint.startswith("https://"):
        raise ValueError("Set OPENSEARCH_ENDPOINT to the HTTPS domain URL first")
    url = endpoint + path
    data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    session = boto3.Session(region_name=REGION)
    creds = session.get_credentials()
    if creds is None:
        raise RuntimeError("No AWS credentials in this Python environment")
    headers = {"Content-Type": "application/json"}
    signed = AWSRequest(method=method, url=url, data=data, headers=headers)
    SigV4Auth(creds.get_frozen_credentials(), "es", REGION).add_auth(signed)
    req = urllib.request.Request(url, data=data, method=method, headers=dict(signed.headers.items()))
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        msg = exc.read().decode("utf-8", errors="replace")
        if exc.code == 400 and "resource_already_exists_exception" in msg:
            return 400, {"info": "photos index already exists; inspect mapping before continuing"}
        raise RuntimeError(f"OpenSearch HTTP {exc.code}: {msg[:2000]}") from exc


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "help"
    if command == "create":
        payload = json.loads(MAPPING_PATH.read_text(encoding="utf-8"))
        status, result = signed_request("PUT", f"/{INDEX}", payload)
    elif command == "mapping":
        status, result = signed_request("GET", f"/{INDEX}/_mapping")
    elif command == "count":
        status, result = signed_request("GET", f"/{INDEX}/_count")
    elif command == "sample":
        status, result = signed_request("POST", f"/{INDEX}/_search", {"size": 5, "query": {"match_all": {}}})
    else:
        print("Usage: python infra/opensearch/manage_index.py create|mapping|count|sample")
        return
    print(json.dumps({"httpStatus": status, "response": result}, indent=2))


if __name__ == "__main__":
    main()
