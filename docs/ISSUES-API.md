# Real issues API - adapter and evidence guide

## Why an adapter is required

STUDIO-5619 specifies behavior and filter names, but not the endpoint URL or complete JSON schema. The included `check-issues.mjs` never calls an invented production URL. Its synthetic test server exists only inside automated unit tests.

Obtain the actual GET endpoint from a real staging request or the backend contract. In browser Developer Tools > Network, open the crawl's issues view, identify the request, and inspect its URL, response JSON and pagination request. Do not share authorization headers, cookies or tokens in tickets or public GitHub commits.

## Configure once

Create a local configuration in the ignored `reports` folder:

```bash
mkdir -p reports
cp examples/issues-config.example.json reports/issues-config.local.json
```

Set these fields from the real response:

| Config field | What to supply |
| --- | --- |
| `endpoint` | Actual GET issues endpoint for the specific completed crawl run; no credentials in the URL |
| `headersFromEnv` | Map an HTTP header name to an environment variable containing its entire value |
| `itemsPath` | Dot path to the issue array, e.g. `items` or `data.items`, only if it matches your response |
| `nextCursorPath` | Dot path to the next cursor, including the terminal null/empty field |
| `cursorParam` | Request parameter for a subsequent cursor; example `cursor` is not asserted to be the product contract |
| `limitParam`, `limit` | Actual page-limit parameter and fixed page size; default `limit=10` |
| `query` | Constant filters applied to every page |
| `fields` | Dot paths inside one record for URL, result, issue_code, pipeline_stage and http_status_code |
| `availabilityPath` | Actual status field indicating provider data availability, if the API exposes one |
| `availableValues` | Exact documented values proving availability; no guessed enum is prefilled |
| `errorPath` | Optional response-body field that indicates an application/provider error despite HTTP 200 |
| `timeoutMs` | Client request timeout, default 30,000 ms |
| `maxPages` | Safety stop, default 20,000; hitting it is incomplete, never success |

The example assumes scalar field values and an absolute returned URL. Nested arrays or a substantially different schema need an adapter change in `scripts/check-issues.mjs`. A missing `http_status_code` is represented as null, because some timeout/parser outcomes may have no status. Other mapped fields must exist; null is preserved if returned by the backend.

Keep all user-facing filters in `query`, not hidden in the endpoint URL. Do not put `cursor` or `limit` in `query`; use the dedicated fields. Existing endpoint query parameters are preserved, and the five ticket filters are included in the report fingerprint.

The collector rejects redirects for requests carrying credentials, reads secrets from environment variables, does not save authorization headers, and does not print the request URL. Reports still contain your issue URLs and outcomes: treat them as internal QA evidence. The `reports/` directory is gitignored.

## Supply authentication without committing a token

If the real API uses an Authorization header:

```bash
read -s SEARCHSTAX_AUTHORIZATION
export SEARCHSTAX_AUTHORIZATION
```

Paste the **entire** actual header value when prompted, such as `Bearer ...` only when that is the actual auth scheme. The checker adds no prefix. For another supported scheme, change `headersFromEnv` to the appropriate real header/environment-variable pair. Do not weaken backend authorization to make the script work.

After collecting reports:

```bash
unset SEARCHSTAX_AUTHORIZATION
```

## Baseline and boundary - simplest exact checks

Run the selected profile to completion first and ensure no unrelated sitemap expands its scope.

```bash
npm run export:expected -- --base https://YOUR-SERVICE.onrender.com --profile boundary --out reports/boundary-expected.json
npm run check:issues -- --config reports/issues-config.local.json --expected reports/boundary-expected.json --out reports/boundary-actual.json
```

For the boundary execution, expected issue pages at `limit=10` are 10, 10 and 5, with 25 unique persistent-404 URL outcomes. The successful boundary seed itself must not appear as an issue. Reconcile all 25 URL identities, not just the count.

For a normal baseline run, export `--profile baseline`; the oracle requires no issues and forbids all baseline document and navigation URLs from appearing. An empty response only passes when data availability is verified, the crawl actually completed and the indexed baseline was independently verified.

## Availability is separate from an empty list

When the real API has an availability field, configure `availabilityPath` and its documented `availableValues`. Every page is checked. A missing/unrecognized status is incomplete, not healthy.

When there is no explicit availability field in the real response, the script defaults to **NEEDS_REVIEW**, even for a complete empty list. After separately proving that the observability data is available for this exact run and time range, the operator can record that assertion with:

```bash
npm run check:issues -- --config reports/issues-config.local.json --expected reports/boundary-expected.json --availability-confirmed --out reports/boundary-actual.json
```

This switch is a **manual QA assertion**, not proof supplied by the website. Do not use it during missing, expired, partial, rate-limited or unavailable-data tests. Never set `availableValues` to include unavailable states just to obtain a pass.

HTTP 401/403/429/5xx, malformed JSON, unexpected schemas, missing terminal-cursor metadata and a repeated cursor produce an **INCOMPLETE** report with any successfully collected records retained. The script does not transparently retry provider errors and hide them. Inspect the failure, correct the cause and start a new collection with a fresh initial cursor.

## Mixed suite - resolve conditional cases

Default mixed oracle:

```text
required failures:       200
forbidden successful URLs: 15,087 (15,000 documents + 87 navigation pages)
conditional fixture URLs: 92
```

The exact final visibility of retries, redirects, exclusions, noindex, incremental, parser and timeout fixtures depends on the real product configuration and final outcomes. The HTTP status of a redirect source is not necessarily the status attached to a final issue. A deliberately malformed response is not proof that the parser reported a specific error code.

Create a resolution file with one entry per conditional path once the prerequisite behavior/contract is established. Each resolution requires an explicit reason:

```json
{
  "/cases/retry-503/0001": {
    "expectation": "forbidden",
    "reason": "Recorded crawler GET returned 503, its retry returned 200, and the final document indexed successfully in the run under test."
  }
}
```

For a required issue, optional `issue_code`, `pipeline_stage`, `result` and `http_status_code` fields can encode **verified actual contract values**. Do not copy the synthetic unit-test enum values. Do not derive an expected list simply by copying the actual issues response: that would conceal missing results.

```bash
npm run export:expected -- --base https://YOUR-SERVICE.onrender.com --profile mixed --resolve reports/resolutions.json --out reports/expected-resolved.json
```

Unresolved entries remain conditional and prevent an overall PASS. A resolved excluded or redirected URL may legitimately be visible as a non-error informational outcome if that is the API contract; classify its expected visibility accordingly and assert the documented non-error `result`. The Jira QA notes say expected exclusions and working redirects are not **errors**; they do not completely define non-error visibility for every query.

## Filters

Set an unchanging query in the real API config. For example, using only ticket-specified names:

```json
"query": {
  "http_status_code": 404,
  "url_search": "blog"
}
```

The collector applies the same filters and limit on every cursor request. It checks equality for `result`, `issue_code`, `pipeline_stage`, `http_status_code` and literal, case-sensitive substring membership for `url_search`. Establish case-folding/normalization semantics separately before using strict checks for those edge cases.

Create a matching oracle. The persistent-failure `issues` profile has no conditional records and is easiest for exact filtering:

```bash
npm run export:expected -- --base https://YOUR-SERVICE.onrender.com --profile issues --status 404 --search blog --out reports/404-blog-expected.json
```

At the default 25-per-status count, each status group has **13 blog URLs and 12 products URLs**. An isolated issues-profile query for `http_status_code=404` and `url_search=blog` should return those 13 URLs, assuming all were attempted.

A mixed profile can include redirect-attributed 404s as well. Do not silently reuse the failure-only expectation for a mixed crawl unless its conditional expectations are resolved. The exporter supports `--status` and `--search`. For `result`, `issue_code`, and `pipeline_stage`, create a reviewed oracle subset using verified mappings, and set its `filter` object to exactly the same filters used by the collector.

Use the real allowed enum values, not the ticket's illustrative examples unless confirmed. A mismatched oracle/API filter fingerprint is rejected rather than producing a misleading missing-URL report.

## Reports and exit codes

| Result | Meaning | Exit |
| --- | --- | ---: |
| PASS | Collection complete, data available, exact oracle resolved, no detected mismatches | 0 |
| FAIL | Completed collection violates the expected set, deduplication, fields, filters or page invariants | 1 |
| INCOMPLETE | Transport, availability, schema, cursor or configuration problem prevented a reliable collection | 1 |
| NEEDS_REVIEW | Data availability, oracle or conditional expectations remain unverified | 2 |

Reports retain normalized records, page sizes/latencies, collection completeness, duplicate/missing/unexpected/forbidden URL lists, outcome mismatches and filter violations. `peakRssBytes` samples memory used by the local collector, not SearchStax or Datadog. Stored page records do not constitute backend memory measurements.

The collector deliberately compares URL strings exactly; it does not strip query parameters or normalize slash/case/encoding differences that could mask defects. Investigate normalization mismatches against the crawler's documented identity contract.

## Invalid cursor/limit and security cases

The collector's happy-path traversal is not a substitute for negative API requests. Send the documented invalid values through Postman/curl against the authorized QA endpoint, not the origin site:

- `limit=-1`, `limit=abc`, `limit=0`, and a documented over-maximum value; verify clean validation. The ticket's QA notes expect 400 for invalid limits.
- Malformed/expired cursor and cursor from another run; verify documented rejection or safe handling, no unrelated data.
- A cursor reused with a different limit/filter; verify documented behavior, not guessed snapshot guarantees.
- Missing/insufficient authorization; verify no issue leakage across tenants, apps or crawl runs.

Limit `1` and `100` are listed in the ticket's QA notes; verify the actual allowed maximum before asserting 100 must be accepted. Record real error shape and codes; do not substitute the origin site's response for the backend response.

## Provider comparison

Collect reports with the same URL outcome input set and filter values. Provider-specific request routing may differ; the five ticket filters must match.

```bash
npm run compare:providers -- --left reports/default.json --right reports/datadog.json --out reports/parity.json
```

`PARITY_ONLY_PASS` means the normalized outcomes match and neither result contains duplicate URLs. It does **not** mean both providers received every expected event. The report also tells you whether both original oracle checks passed. Verify equivalent source events, complete ingestion, run scoping and provider retention separately.
