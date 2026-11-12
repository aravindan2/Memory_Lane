# Memory Lane — OpenSearch integration guide (Fall 2026)

This kit is tailored to the existing project (`us-east-1`, AWS account `456157355328`):

- **Domain and index:** `photos` / `photos` (Amazon OpenSearch Service **managed domain**, NOT Serverless)
- **Photo bucket B2:** `memory-lane-photos-456157355328`
- **LF1:** `index-photos` (currently logs `INDEX_DOCUMENT`, plus Rekognition/custom labels)
- **LF2:** `search_photos` (already deployed; calls Lex, currently returns 503 until OpenSearch is set)
- **API:** `https://oi25a7sswf.execute-api.us-east-1.amazonaws.com/dev`
- **Lex:** `P9VBDDBKUR` / alias `JLZRFWX8RA` / `en_US`, `SearchIntent` with `KeywordOne` and `KeywordTwo`
- **CI/CD:** P1 deploys both Lambdas; P2 deploys frontend.

Do not create a second domain if teammate has already started `photos`. Agree on one owner of domain/index and policies. You don't have to recreate API Gateway, Lex, S3, P1, P2, or CloudFormation.

## 1. Check whether domain already exists

```powershell
aws opensearch describe-domain --domain-name photos --region us-east-1 --query "DomainStatus.{Endpoint:Endpoint,Endpoints:Endpoints,Processing:Processing,Status:DomainProcessingStatus,AdvancedSecurity:AdvancedSecurityOptions.Enabled}" --output json
```

If it exists, use its settings. If not, the teammate can create it from **Amazon OpenSearch Service → Domains → Create domain**:

- **Standard create**; **Search** use case; **Dev/test** template.
- **Domain name:** `photos`; use a supported OpenSearch engine version, not legacy Elasticsearch engine.
- **Deployment:** single AZ, **without standby**, one `t3.small.search` data node, no dedicated master, EBS `gp3` about **10 GiB**, one node. This is a small demo, not a production high-availability layout. Check price before confirming; instance and storage can incur continuous charges. Do not choose OpenSearch Serverless.
- **Network:** for the easiest Lambda integration, **public endpoint with a restrictive IAM-signed access policy**. Existing Lambdas are not configured to access a VPC-only domain. Public network reachability does not mean anonymous access: NEVER permit `Principal: "*"` with unrestricted domain actions.
- Require HTTPS, enable node-to-node encryption and encryption at rest. For a class demonstration, IAM-restricted policies without fine-grained access control can be simpler, **if that option is available**. AWS recommends fine-grained access control for real deployments. If enabled, your teammate must additionally map LF1/LF2 IAM execution roles to suitable OpenSearch security roles, or those Lambdas may get 403 even when AWS IAM and domain policies allow them.
- Domain creation is asynchronous; wait until it reports `Active` / `Processing: false` and has an endpoint.

Domain and index are **different**: the domain provisions the cluster; `photos` index is created inside it separately.

## 2. Get the actual endpoint and role ARNs

```powershell
$Region = 'us-east-1'
$Bucket = 'memory-lane-photos-456157355328'
$Domain = aws opensearch describe-domain --domain-name photos --region $Region --output json | ConvertFrom-Json
$EndpointHost = $Domain.DomainStatus.Endpoint
if (-not $EndpointHost) { $EndpointHost = $Domain.DomainStatus.Endpoints.vpc }
$Endpoint = "https://$EndpointHost"
$Endpoint
$LF1Role = aws lambda get-function-configuration --function-name index-photos --region $Region --query Role --output text
$LF2Role = aws lambda get-function-configuration --function-name search_photos --region $Region --query Role --output text
$LF1Role
$LF2Role
aws sts get-caller-identity
```

Use the **actual** execution role ARNs and endpoint; do not use the CodeBuild or API Gateway roles. A VPC endpoint is not usable by a Lambda outside that VPC without additional networking configuration.

## 3. Domain access policy (teammate, owner of the domain)

Set a resource-based **domain access policy** that permits these two known execution roles to their OpenSearch data operations. The following role ARNs were visible in our project; inspect your live outputs before applying them:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::456157355328:role/memory-lane-index-photos-role"},
      "Action": ["es:ESHttpPut"],
      "Resource": "arn:aws:es:us-east-1:456157355328:domain/photos/photos/_doc/*"
    },
    {
      "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::456157355328:role/service-role/search_photos-role-2825ja5i"},
      "Action": ["es:ESHttpPost"],
      "Resource": "arn:aws:es:us-east-1:456157355328:domain/photos/photos/_search"
    }
  ]
}
```

**Do not replace the whole existing domain policy blindly.** Your teammate may need to add the **actual IAM principal that creates/tests the index** (signed requests) with `es:ESHttpPut`, `es:ESHttpGet`, and `es:ESHttpPost` on `arn:aws:es:us-east-1:456157355328:domain/photos/*`. A role assumed by CLI often has an `arn:aws:sts::...:assumed-role/...` session identity; its policy principal must be the **underlying IAM role ARN**, not the STS session ARN. Remove temporary administrator access after index setup if no longer needed. The IAM identity also needs an identity policy granting the relevant data-plane actions.

If fine-grained access control is enabled, this policy is *not sufficient by itself*: additionally create/map OpenSearch security roles that permit LF1 to index and LF2 to search the `photos` index. See AWS OpenSearch FGAC documentation.

## 4. Add identity-based IAM policies to the Lambda execution roles (user)

For the Lambda **execution roles** (not CodeBuild):

**LF1 policy**:

```json
{
  "Version":"2012-10-17",
  "Statement":[{"Effect":"Allow","Action":["es:ESHttpPut"],"Resource":"arn:aws:es:us-east-1:456157355328:domain/photos/photos/_doc/*"}]
}
```

**LF2 policy** (add alongside existing Lex `RecognizeText` and S3 `GetObject` policies):

```json
{
  "Version":"2012-10-17",
  "Statement":[{"Effect":"Allow","Action":["es:ESHttpPost"],"Resource":"arn:aws:es:us-east-1:456157355328:domain/photos/photos/_search"}]
}
```

Apply these in IAM → Roles → the actual role → Add permissions → Create inline policy (JSON). Example names: `MemoryLaneOpenSearchLF1Write` and `MemoryLaneOpenSearchLF2Search`. Don't replace existing permissions.

## 5. Create the `photos` index (teammate)

Use the included `infra/opensearch/photos_mapping.json`. It maps exactly:

- `objectKey`: keyword
- `bucket`: keyword
- `createdTimestamp`: date
- `labels`: text using the **English analyzer**, with a `keyword` subfield for exact comparisons
- 1 primary shard, 0 replicas (one-node demo only)

The index is separate from the domain! Use a credentialed user/role allowed by the domain policy to create it. For PowerShell:

```powershell
$env:OPENSEARCH_ENDPOINT = $Endpoint
$env:OPENSEARCH_INDEX = 'photos'
python -m pip install boto3
python .\infra\opensearch\manage_index.py create
python .\infra\opensearch\manage_index.py mapping
python .\infra\opensearch\manage_index.py count
```

`create` uses AWS SigV4 and does not expose AWS keys in command-line arguments. If the index already exists, **do not delete it**; inspect its mapping. `english` on labels is important for singular/plural queries in LF2. If local boto3 can't load the AWS credentials that the CLI uses, configure an appropriate named AWS profile/environment for boto3; never paste access keys in source files or chat.

## 6. Add OpenSearch writer to LF1 (user)

Copy the included `backend/index_photos/opensearch_writer.py` into the existing backend directory.

In your **existing** `backend/index_photos/lambda_function.py`, near the imports add:

```python
from opensearch_writer import index_photo_document
```

Immediately after the Lambda builds and logs its existing four-field `document` (`objectKey`, `bucket`, `createdTimestamp`, `labels`), invoke:

```python
index_photo_document(document)
```

Do not replace LF1's S3 event handling, custom label parsing, Rekognition call, or `INDEX_DOCUMENT` logging. This helper uses stdlib/boto3/botocore with SigV4; no third-party OpenSearch client is required. It stores a deterministic SHA-256 ID for `bucket/objectKey`, so reuploading a filename replaces its indexed metadata rather than creating duplicate records. The index `_source` stays exactly the four fields required by the assignment.

**Mandatory P1 buildspec change:** package BOTH Python files into LF1's ZIP (preserve your existing LF2 commands):

```yaml
      - zip -j /tmp/index_photos.zip backend/index_photos/lambda_function.py backend/index_photos/opensearch_writer.py
```

**Do not** push this helper to GitHub before updating the buildspec: otherwise LF1's next P1 deployment may fail with `ImportModuleError`. Confirm with `python -m py_compile ...` locally.

## 7. Set Lambda environment variables without wiping existing Lex settings (user)

Once the domain is active, reachable, authorized, and the index exists, set `OPENSEARCH_ENDPOINT` and `OPENSEARCH_INDEX` on **both** existing functions. Preserve all existing LF2 Lex env vars (already configured) and any existing LF1 vars.

```powershell
$Region = 'us-east-1'
$Endpoint = 'https://REPLACE-WITH-ACTUAL-DOMAIN-ENDPOINT'
foreach ($Name in @('index-photos', 'search_photos')) {
    $Config = aws lambda get-function-configuration --function-name $Name --region $Region --output json | ConvertFrom-Json
    $Vars = @{}
    if ($Config.Environment -and $Config.Environment.Variables) {
        $Config.Environment.Variables.PSObject.Properties | ForEach-Object { $Vars[$_.Name] = $_.Value }
    }
    $Vars['OPENSEARCH_ENDPOINT'] = $Endpoint
    $Vars['OPENSEARCH_INDEX'] = 'photos'
    @{Variables = $Vars} | ConvertTo-Json -Depth 8 | Set-Content "$env:TEMP\$Name-opensearch-env.json" -Encoding Ascii
    aws lambda update-function-configuration --function-name $Name --region $Region --environment "file://$env:TEMP\$Name-opensearch-env.json"
    aws lambda wait function-updated --function-name $Name --region $Region
}
```

Verify `LEX_BOT_ID`, `LEX_BOT_ALIAS_ID`, `LEX_LOCALE_ID` and `PHOTOS_BUCKET` are still set on LF2. If environment variables were never configured, add them too before testing.

## 8. Deploy via P1, then test a NEW upload (user)

Commit the LF1 writer, LF1 import/call, index mapping and scripts, and updated buildspec; then `git pull --rebase origin main` and `git push origin main`. P1 should deploy LF1 + LF2. Check stage statuses and the two Lambdas' LastUpdateStatus. New photos should index automatically.

From repo root with an existing `test.jpg` and a usable `$ApiKeyValue`:

```powershell
$ApiUrl = 'https://oi25a7sswf.execute-api.us-east-1.amazonaws.com/dev'
$PhotoPath = (Resolve-Path .\test.jpg).Path
$Filename = "search-demo-$(Get-Date -Format yyyyMMddHHmmss).jpg"
curl.exe -i -X PUT "${ApiUrl}/photos?filename=$Filename" -H "x-api-key: $ApiKeyValue" -H 'Content-Type: image/jpeg' -H 'x-amz-meta-customLabels: SearchDemo,BlueSky' --data-binary "@$PhotoPath"
aws logs tail '/aws/lambda/index-photos' --since 5m --format short
```

Look for an `OpenSearch indexed ... HTTP 201/200` log line. If LF1 invocation throws 403, check both Lambda IAM and domain access policies, plus FGAC mappings if enabled. If connection times out, check public/VPC network selection. If index does not exist, create it before retrying.

## 9. Backfill photos already in B2 (user)

LF1 previously only logged photos; those are NOT automatically stored in OpenSearch. Invoke LF1 with synthetic S3 PUT events using the included backfill script. It does not modify S3 files, and it reruns Rekognition (billable).

```powershell
python .\infra\opensearch\backfill_existing_s3.py --limit 2
python .\infra\opensearch\manage_index.py count
python .\infra\opensearch\backfill_existing_s3.py --all
python .\infra\opensearch\manage_index.py count
python .\infra\opensearch\manage_index.py sample
```

Requires CLI user's credentials to have `s3:ListBucket` on B2 and `lambda:InvokeFunction` on `index-photos`. Do a small sample first. If your LF1 event code requires additional S3 record keys beyond the usual ones, adapt the synthetic event payload accordingly. Backfill script runs synchronously and shows errors. A 10K+ photo set should instead use batched/event-driven processing, but this is appropriate for a small class demo.

## 10. Test the real search endpoint (both developers)

After the index contains documents, LF2's configured Lex should resolve natural-language requests and LF2 will sign an OpenSearch POST to `/photos/_search`, return original label arrays and presigned URLs for private S3 photos:

```powershell
curl.exe -i 'https://oi25a7sswf.execute-api.us-east-1.amazonaws.com/dev/search?q=show%20me%20cats' -H "x-api-key: $ApiKeyValue"
curl.exe -i 'https://oi25a7sswf.execute-api.us-east-1.amazonaws.com/dev/search?q=show%20me%20cats%20and%20dogs' -H "x-api-key: $ApiKeyValue"
aws logs tail '/aws/lambda/search_photos' --since 10m --format short
```

- Successful matches: HTTP 200, body `{"results":[{"url":"<actual presigned S3 URL>","labels":["Cat","Dog"]}]}`.
- Legitimate no-match query: HTTP 200, `{"results":[]}`.
- HTTP 503: `OPENSEARCH_ENDPOINT` or another LF2 required config still missing.
- HTTP 502: inspect LF2 CloudWatch logs; likely Lex/OpenSearch/IAM/network error.
- Upload custom label `SearchDemo` and verify that **Lex extracts the custom label** from the utterance; closed-vocabulary Lex slots may fail arbitrary custom labels even when OpenSearch indexing works.
- Confirm returned `url` actually renders the image in the frontend. Private B2 remains private; presigned GET URLs are time-limited.

## 11. Post-demo housekeeping

Do not store API keys in GitHub or a public static website's source as secrets; a browser-exposed key is not authentication. Use quotas/throttling and rotate the key you previously pasted publicly. Managed OpenSearch incurs continuous node/storage costs outside any applicable free-tier credits. After grading and evidence collection, coordinate a snapshot/backup if needed and delete the domain to stop ongoing charges.

## References

- AWS domain creation: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/createupdatedomains.html
- AWS IAM/domain policies: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/ac.html
- AWS signing requirements: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/managedomains-signing-service-requests.html
- AWS FGAC: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/fgac.html
- OpenSearch index creation: https://docs.opensearch.org/latest/api-reference/index-apis/create-index/
