"""Replay synthetic S3 Put events to the EXISTING LF1 for old S3 photos.

Does not alter any S3 object. Each invocation reuses LF1's Rekognition,
custom labels, and OpenSearch indexing logic. Costs apply per invocation.

Usage:
  python infra/opensearch/backfill_existing_s3.py --limit 2
  python infra/opensearch/backfill_existing_s3.py --all
"""
import argparse
import json
import sys
from urllib.parse import quote_plus

import boto3

REGION = "us-east-1"
BUCKET = "memory-lane-photos-456157355328"
FUNCTION = "index-photos"


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--limit", type=int, help="Replay only N images as a test")
    mode.add_argument("--all", action="store_true", help="Replay all existing images")
    args = parser.parse_args()

    s3 = boto3.client("s3", region_name=REGION)
    fn = boto3.client("lambda", region_name=REGION)
    processed = 0
    failed = 0
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET):
        for item in page.get("Contents", []):
            if args.limit is not None and processed >= args.limit:
                print(f"Finished limited run: {processed} attempts, {failed} failures")
                return 1 if failed else 0
            key = item["Key"]
            if not key.lower().endswith((".jpg", ".jpeg", ".png")):
                continue
            record = {
                "eventSource": "aws:s3",
                "eventName": "ObjectCreated:Put",
                "eventTime": item["LastModified"].isoformat().replace("+00:00", "Z"),
                "s3": {"bucket": {"name": BUCKET}, "object": {"key": quote_plus(key)}},
            }
            event = {"Records": [record]}
            response = fn.invoke(FunctionName=FUNCTION, InvocationType="RequestResponse",
                                 Payload=json.dumps(event).encode("utf-8"))
            reply = response["Payload"].read().decode("utf-8", errors="replace")
            processed += 1
            if "FunctionError" in response or response.get("StatusCode") != 200:
                failed += 1
                print(f"ERROR {key}: {reply[:500]}")
            else:
                print(f"OK {key}")
    print(f"Finished: {processed} attempts, {failed} failures")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
