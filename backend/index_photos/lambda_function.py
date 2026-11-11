
import json
import logging
from urllib.parse import unquote_plus

import boto3

s3 = boto3.client("s3")
rekognition = boto3.client("rekognition")

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event, context):
    documents = []

    for record in event.get("Records", []):
        if record.get("eventSource") != "aws:s3":
            continue

        # 1. Get the uploaded photo's location.
        bucket = record["s3"]["bucket"]["name"]
        key = unquote_plus(record["s3"]["object"]["key"])

        # 2. Retrieve user-supplied custom labels.
        response = s3.head_object(Bucket=bucket, Key=key)
        raw_labels = response.get("Metadata", {}).get(
            "customlabels", ""
        )

        custom_labels = [
            label.strip()
            for label in raw_labels.split(",")
            if label.strip()
        ]

        # 3. Detect labels with Rekognition.
        result = rekognition.detect_labels(
            Image={
                "S3Object": {
                    "Bucket": bucket,
                    "Name": key
                }
            },
            MaxLabels=100,
            MinConfidence=70
        )

        detected_labels = [
            item["Name"]
            for item in result["Labels"]
        ]

        # 4. Combine custom and detected labels.
        # Remove duplicate labels, ignoring capitalization.
        labels = []
        seen = set()

        for label in custom_labels + detected_labels:
            normalized = label.casefold()
            if normalized not in seen:
                seen.add(normalized)
                labels.append(label)

        # 5. Prepare the Elasticsearch document.
        document = {
            "objectKey": key,
            "bucket": bucket,
            "createdTimestamp": record["eventTime"],
            "labels": labels
        }

        # Temporary: log it until Elasticsearch is ready.
        logger.info("INDEX_DOCUMENT: %s", json.dumps(document))
        documents.append(document)

    return {
        "statusCode": 200,
        "processed": len(documents),
        "documents": documents
    }

# Testing automatic GitHub CI/CD trigger