# STUDIO-5619 - Crawl Validation Lab

**15,000 valid document URLs + 292 additional fixtures.** A complete, dependency-free Node.js website for GitHub and a Render **Web Service**.

Ticket: https://searchstax.atlassian.net/browse/STUDIO-5619

This project follows the ticket description and QA comments retrieved on September 25, 2026. It tests the existing crawl-issue retrieval behavior; **email notifications are out of scope**.

## Start here

1. Extract the ZIP. Upload the **contents** of `studio-5619-crawl-lab` to a new GitHub repository, preserving all subfolders.
2. Create a Render **Web Service**, not a Static Site. Connect that repository. Build: `npm ci`. Start: `npm start`. Health check: `/healthz`.
3. Set `ADMIN_TOKEN` to a long random secret. Deploy. Open the resulting Render URL to see the dashboard.
4. In SearchStax, use `https://YOUR-SERVICE.onrender.com/crawl` as the Start URL. **Do not start from the dashboard `/`.** Configure the crawl as described below.
5. After a completed crawl and settled log ingestion, export an expected manifest and run the issue checker against the **real SearchStax issues endpoint**.

> These are real HTTP endpoints, not 15,000 links to the same page. Each valid document has a stable URL, unique title, body marker, canonical URL, ETag and Last-Modified value. Pages are generated on demand, so the repository does not need 15,000 HTML files.

## 1. What is included?

| Fixture family | URL count | Behavior |
| --- | ---: | --- |
| Valid documents | **15,000** | Unconditional GET returns 200; unique, extractable server-rendered HTML |
| Persistent HTTP failures | **200** | 25 each of 401, 403, 404, 410, 429, 500, 502 and 503 |
| Recoverable retries | 20 | Ten 429 and ten 503 URLs; first GET fails, subsequent GET succeeds by default |
| Successful redirects | 20 | Five each of 301, 302, 307 and 308; targets are existing valid documents |
| Broken redirects | 5 | 302 to existing persistent-404 fixtures |
| Redirect loop | 2 | A redirects to B; B redirects to A |
| Configured exclusions | 5 | 200 if requested; exclusion must be configured in the crawler |
| robots.txt exclusions | 5 | Real `/robots.txt` Disallow rules |
| Meta/header noindex | 10 | Five HTML robots tags and five actual X-Robots-Tag response headers |
| Unchanged incremental | 10 | Stable content, ETag/Last-Modified; conditional GET can return 304 |
| Delayed responses | 3 | Eight-second delay by default; crawler timeout determines outcome |
| Empty HTML | 2 | HTTP 200, zero-byte HTML body |
| Invalid parser input | 2 | Deliberately invalid bytes served as application/pdf, not a real PDF |
| Large HTML | 2 | At least 1 MiB by default; size-limit outcome depends on crawler settings |
| URL encoding/query edges | 6 | Space, Unicode, case, long path, repeated query key, encoded plus |
| **Additional fixtures subtotal** | **292** | All additional to the valid 15,000 |
| **Total fixture URLs** | **15,292** | Does not include navigation/control endpoints |

The mixed HTML link graph also contains **87 successful navigation pages**, giving **15,379 unique discoverable HTML-link targets including its seed**. Redirect targets and duplicate links reuse existing URLs. Ancillary requests such as robots.txt are separate. Do not equate total request count, discovered URLs, indexed document count and issues count.

There are **200 expected persistent-failure URL outcomes** when all of those URLs are discovered and attempted. The remaining **92 extra URLs have configuration-dependent or attribution-dependent expectations**. Their exact issue visibility must be resolved using the actual crawler settings and contract. They are not automatically declared passing.

## 2. Upload to a new GitHub repository

### Option A - GitHub web interface

Create an empty repository, for example `studio-5619-crawl-lab`. Extract the ZIP on your Mac. Open the extracted folder and upload **its contents**, including `lib`, `public`, `scripts`, `tests`, `docs`, `data`, `examples` and the root files.

Before committing, the repository root should contain:

```text
package.json
package-lock.json
server.mjs
render.yaml
README.md
.node-version
.env.example
.gitignore
.github/workflows/test.yml
lib/
public/
scripts/
tests/
docs/
data/
examples/
```

On macOS, Command + Shift + period shows hidden files in Finder. Do not upload a real `.env`. Upload the included `.env.example` only. Do not upload the ZIP as the only repository file: Render needs the extracted source.

### Option B - VS Code terminal / Git

From the extracted project folder:

```bash
git init
git add .
git commit -m "Add STUDIO-5619 crawler QA site"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/studio-5619-crawl-lab.git
git push -u origin main
```

Replace `YOUR-USERNAME`. Create the GitHub repository first and complete GitHub authentication when prompted. These commands assume a new, empty repository.

## 3. Deploy on Render

In Render, choose **New > Web Service**, connect GitHub and select the new repository.

| Render field | Value |
| --- | --- |
| Service type | **Web Service** |
| Runtime / Language | **Node** |
| Branch | `main` |
| Root Directory | Leave blank when `package.json` is at repository root |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| Node version | `.node-version` selects Node 24; application also tested locally with Node 22 |
| Instance count | **1** for deterministic retry/reset tests |
| Environment variable | `ADMIN_TOKEN` = a long, unique secret |

Render supplies `PORT`; the server binds to `0.0.0.0` and uses that value. No publish directory, static build or database is needed. The server uses `RENDER_EXTERNAL_URL` for absolute links; `BASE_URL` can override it with the exact public origin.

Generate a secret locally:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy the output into Render's `ADMIN_TOKEN` environment variable. Do not paste a secret into the repository, a ticket, screenshots or this README.

### Blueprint alternative

The included `render.yaml` supports **New > Blueprint**. Connect the repository and review the generated service before creating it. Its `ADMIN_TOKEN` uses `generateValue: true`; view the generated value in the Render service's Environment settings. Blueprint defaults to `plan: free` to avoid silently opting into paid compute. Review the chosen plan and any charges yourself.

### Hosting limitations that matter for QA

Render's Free web services spin down after 15 minutes without inbound traffic. Restarts, redeploys and free-service spin-downs lose in-memory state and ephemeral filesystem changes. This project intentionally keeps retry attempts and observations in memory. A boot/reset ID is shown on the dashboard and responses so a changed run state can be detected.

Warm the site by opening `/healthz` before validation. Do not redeploy, restart, reset or scale instances during a stateful run. An always-on paid instance avoids idle spin-down, but a single process still loses in-memory state on restart. Use an external shared store before testing multi-instance stateful behavior; this repository does not pretend to provide that durability.

A free service is suitable for a deployment smoke check. For meaningful timing measurements, use a stable hosting configuration and record its resources; otherwise cold starts and origin throttling can be mistaken for crawler regressions. This site does not establish a SearchStax performance SLA.

## 4. Check the deployed site

Replace `YOUR-SERVICE` everywhere with the hostname Render gives you.

```text
Dashboard:              https://YOUR-SERVICE.onrender.com/
Health:                 https://YOUR-SERVICE.onrender.com/healthz
Main mixed crawl seed:  https://YOUR-SERVICE.onrender.com/crawl
First valid URL:        https://YOUR-SERVICE.onrender.com/valid/00001
Last valid URL:         https://YOUR-SERVICE.onrender.com/valid/15000
Known 404:              https://YOUR-SERVICE.onrender.com/cases/http-404/blog-0001
Manifest:               https://YOUR-SERVICE.onrender.com/api/manifest?profile=mixed
Mixed sitemap index:    https://YOUR-SERVICE.onrender.com/sitemaps/mixed.xml
```

```bash
curl -I https://YOUR-SERVICE.onrender.com/valid/00001
curl -I https://YOUR-SERVICE.onrender.com/cases/http-404/blog-0001
curl -I https://YOUR-SERVICE.onrender.com/cases/redirect-302/0001
curl -I https://YOUR-SERVICE.onrender.com/cases/noindex-header/0001
```

Expect 200, 404, 302 with `Location: /valid/00001`, and 200 with `X-Robots-Tag: noindex`, respectively. Use the actual HTTP response in Network/curl, not the words printed on a page. `curl -I` makes HEAD requests; HEAD does not consume retry GET attempts in this fixture.

From your local project folder, run the lightweight smoke check:

```bash
npm run verify -- --base https://YOUR-SERVICE.onrender.com
```

An explicit full origin check requests all 15,000 valid URLs:

```bash
npm run verify -- --base https://YOUR-SERVICE.onrender.com --all-valid --concurrency 3 --pause-ms 100 --out reports/site-check.json
```

Run this only against your own fixture service and within your hosting/request budget. Default smoke checks sample three valid URLs; `--all-valid` is necessary for exhaustive checking. This script verifies origin behavior, not crawler extraction/indexing. It avoids retry GETs, but creates other origin observations. **Reset before the real crawl.**

## 5. Configure the SearchStax staging crawl

Use a dedicated QA application/crawl definition with adequate document entitlement.

| Setting / prerequisite | Guidance for the mixed suite |
| --- | --- |
| Start URL | `https://YOUR-SERVICE.onrender.com/crawl` |
| Crawl scope | Allow the same origin and `/crawl`, `/valid`, `/cases`; do not restrict scope to descendants of `/crawl/` alone |
| Crawl type | **Full crawl** first; incremental is a separate follow-up execution |
| URL/item budget | At least the full discovery set; **20,000 or higher** is a suggested starting allowance, subject to actual item-budget semantics and entitlement |
| Depth | At least **5** is a conservative setting; the fixture's deepest ordinary navigation path is seed > group/directory > document |
| Robots | Honor robots for the default exclusion test; run ignore-robots as a separately documented variation |
| Exclusion rule | Add a rule matching `/cases/configured-exclusion/` using your crawler's supported syntax |
| HTTP retries | At least one retry for 429 and 503 to exercise the default recovery sequence |
| Stop/error thresholds | High enough to finish despite 200 intentional persistent failures and additional configured failures; inspect actual threshold semantics |
| Timeout | Below `DELAY_MS` for a timeout outcome; above it for successful delayed fetches. Example fixture delay 8 seconds, crawler timeout 3 seconds |
| Parser/file types | Enable PDF/MIME extraction if exercising the deliberately invalid parser bytes |
| Content-size limit | Below the large-response size only when testing intentional size rejection |
| Field mapping | Ordinary title/body extraction for valid HTML; avoid a mapping that excludes all fixtures |
| Request rate | Use an authorized, conservative QA rate; monitor origin and crawler saturation rather than assuming a throughput target |

Set the threshold and retry policies deliberately. Persistent 429/503 fixtures can cause crawler backoff; this is intentional and must not be mistaken for proof of a performance regression. A crawler that stops at a budget, depth, exclusion or error threshold has not generated the complete expected dataset.

To test different exclusion outcomes, record the configuration per execution. Do not silently change the baseline halfway through pagination.

## 6. Choose a profile

All profiles are part of the same QA suite. The mixed seed includes the full 15,000 plus every additional scenario.

| Profile | Start URL suffix | Sitemap index | Purpose |
| --- | --- | --- | --- |
| `mixed` | `/crawl` | `/sitemaps/mixed.xml` | Main 15,292-fixture integration run |
| `baseline` | `/crawl/baseline` | `/sitemaps/baseline.xml` | Clean 15,000-document regression/performance baseline |
| `boundary` | `/crawl/boundary` | `/sitemaps/boundary.xml` | Exactly 25 persistent 404 fixtures: issue pages 10, 10, 5 |
| `issues` | `/crawl/issues` | `/sitemaps/issues.xml` | Persistent failure cohort only: 200 by default |

The ordinary `/sitemap.xml` reflects `CRAWL_PROFILE` (default `mixed`). robots.txt intentionally has **no Sitemap directive**. If the crawler automatically probes `/sitemap.xml` or discovers other whole-site URLs, **disable that behavior for isolated profiles, use the profile-specific sitemap, or set `CRAWL_PROFILE` accordingly before the run**. Keep the crawl scope/profile consistent; a baseline run contaminated by the mixed sitemap is not a clean baseline. An exact boundary expectation assumes only that boundary graph was crawled and all navigation succeeded.

## 7. Reset, run and retain evidence

Use the dashboard reset form with `ADMIN_TOKEN`. Alternatively, in your terminal:

```bash
export BASE_URL='https://YOUR-SERVICE.onrender.com'
read -s ADMIN_TOKEN
export ADMIN_TOKEN
curl --fail-with-body -X POST "$BASE_URL/admin/reset" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"label":"studio5619-mixed-001"}'
unset ADMIN_TOKEN
```

Do not add the secret to your shell command history. A reset only affects this website. It does not clear the index, Datadog, a crawl run or its issues.

Capture the fixture boot ID, profile, manifest, crawler settings, app ID, crawl-definition ID, crawl-run ID, start/end timestamps and provider. Do not browse retry URLs after reset: manual GETs consume the initial failure. HEAD probes do not. Observe `/api/observations` and actual crawler events to prove a retry was recovered by the crawler rather than by a manual visit.

Run the crawler to completion. Confirm the intended URLs were discovered/attempted, valid content was indexed, and provider ingestion has settled. A GET 200 alone does not prove successful parsing/indexing. Do not compare expected URL sets from an incomplete or still-changing run.

## 8. Validate the real issues endpoint

The ticket names `limit`, `next_cursor`, `url_search`, `result`, `issue_code`, `pipeline_stage` and `http_status_code`. It does **not** specify the endpoint URL, response envelope, cursor request parameter, authorization scheme, exact enums or unavailable-data status shape.

Therefore, this repository includes a **configurable collector**, not a fabricated SearchStax API. Copy `examples/issues-config.example.json` to a local ignored file under `reports/`, then set the real endpoint and schema paths using a real staging response or the backend contract. See **[docs/ISSUES-API.md](docs/ISSUES-API.md)** for full instructions, authentication, filtering, availability handling and report meanings.

Export the oracle for your actual hostname/profile:

```bash
npm run export:expected -- --base https://YOUR-SERVICE.onrender.com --profile mixed --out reports/expected.json
```

For the boundary execution:

```bash
npm run export:expected -- --base https://YOUR-SERVICE.onrender.com --profile boundary --out reports/boundary-expected.json
```

Then collect real issue pages, keeping the same limit and filters throughout:

```bash
npm run check:issues -- --config reports/issues-config.local.json --expected reports/expected.json --out reports/issues.json
```

The checker identifies duplicate URLs, missing expected failures, forbidden successes, unexpected URLs, field/filter mismatches, pagination anomalies, cursor loops and incomplete retrieval. It records page sizes, retrieval time and the collector process's sampled peak RSS (not backend memory). Mixed-profile reports remain **NEEDS_REVIEW** while conditional cases or data availability are unresolved. This is intentional.

Resolve conditional expectations using crawler configuration and documented behavior **before** using them as pass criteria, not by copying whatever issues happened to be returned. `examples/resolutions.example.json` illustrates the format. Preserve those reasons with the test evidence.

## 9. Datadog, unavailable data and regression

Use the actual platform/provider configuration or an authorized backend harness to query equivalent standardized events through the default provider and Datadog. Collect both reports, then:

```bash
npm run compare:providers -- --left reports/default.json --right reports/datadog.json --out reports/provider-parity.json
```

It compares URL, result, issue_code, pipeline_stage and http_status_code, ignoring record order. Both collections must be complete and their data availability verified. A parity-only pass does not prove completeness: both providers could omit the same URL, so validate each against the oracle too.

**Not reproducible from a public website alone:** observability retention expiry, provider outage/rate limiting, backend authorization failures, an indexer rejection, or equivalent versioned events injected into two providers. The website's own logs are deliberately named `qa_fixture.*`; they are **not** SearchStax `operational.outcome.recorded` events. Do not send synthetic lookalike logs and call that crawler validation.

Follow the complete **[QA plan](docs/QA-PLAN.md)** for these platform-only checks, pagination limits, empty results, incremental execution and pipeline performance/regression. Actual results are **Not run** until executed in your environment.

## 10. Local development and configuration

Install a supported Node.js runtime; Node 24 is selected for Render. There are no third-party runtime packages.

```bash
npm ci
cp .env.example .env
# Edit .env: set ADMIN_TOKEN to a random secret.
npm run dev
```

Open `http://localhost:3000`. `npm run dev` loads `.env`; `npm start` reads the process environment, as on Render. `npm test` uses isolated ephemeral local ports and synthetic local test data. It does not call SearchStax or Datadog.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` locally | Render injects its own port |
| `BASE_URL` | Render external URL, otherwise request origin | Exact public origin, no path |
| `ADMIN_TOKEN` | unset | Enables protected POST reset; unset disables reset |
| `ISSUES_PER_STATUS` | `25` | Integer 25-2000; eight persistent failure categories |
| `RETRY_FAILURES` | `1` | Number of failing GET attempts before recovery, 1-5 |
| `DELAY_MS` | `8000` | Timeout-fixture delay, 1-60000 ms; at most 20 pending delayed responses |
| `LARGE_BODY_BYTES` | `1048576` | Minimum payload target for two large responses, up to 5 MiB |
| `CONTENT_VERSION` | `v1` | Change to alter stable document content/ETag |
| `CONTENT_LAST_MODIFIED` | `Wed, 01 Jan 2025 00:00:00 GMT` | Change when testing modified-since behavior with changed content |
| `CRAWL_PROFILE` | `mixed` | Profile used by `/sitemap.xml` |
| `REQUEST_LOGGING` | `false` | Optional structured origin-response logs; adds logging overhead |

For a heavier **issue pagination** test, `ISSUES_PER_STATUS=1500` gives **12,000 persistent failures + 92 other extras + the same 15,000 valid documents = 27,092 fixture URLs**. Increase budgets/entitlement and error thresholds first. Download the live manifest again and pass `--issues-per-status 1500` to the oracle exporter. This optional setting is not required for the default 15,000-valid-URL request.

## 11. Troubleshooting

| Symptom | Check |
| --- | --- |
| Render says package.json is missing | Source files are nested under an extra folder; fix Root Directory or move contents to repository root |
| Only a dashboard or no dynamic pages | You selected a Static Site; create a Node Web Service instead |
| Crawler does not discover the 15,000 | Start from `/crawl`; allow `/valid` and `/cases`, depth and budget; inspect sitemap/profile settings |
| Fewer persistent failures than expected | Crawl may have stopped early, failed discovery, applied exclusions/backoff, or logs may not have settled |
| Reset returns 503 | ADMIN_TOKEN is not configured; retry after deployment of the environment change |
| Reset returns 401 | Wrong token; do not include extra quotes/newlines in its value |
| Retry succeeds immediately | A previous GET consumed the failure; stop traffic, reset, check boot ID and use one instance |
| Incremental returns 200 | Crawler may not send conditional headers. Confirm unchanged detection in actual platform events; do not force 304 unconditionally |
| Mixed checker returns NEEDS_REVIEW | Conditional expectations or availability remain unverified; this is not an automatic failure or pass |
| Checker reports missing cursor/schema field | Adapt config paths to the real response; do not treat missing metadata as the last page |
| Provider shows no events | Verify actual emitted event fields, crawl/app IDs, time range, ingestion and retention separately |

## Repository map

`server.mjs` serves the website. `lib/catalog.mjs` defines the complete deterministic dataset. `public/` contains the dashboard and CSS. `scripts/` contains origin checks, expected-output export, real API pagination checks and parity comparison. `tests/` contains local self-tests. `data/` contains the default path inventory. `docs/` contains detailed QA/API instructions and local verification evidence. `examples/` contains adapter/resolution templates without secrets.

## Sources

Ticket and QA comments: https://searchstax.atlassian.net/browse/STUDIO-5619

Deployment behavior verified against Render documentation on September 25, 2026:
- https://render.com/docs/deploy-node-express-app
- https://render.com/docs/web-services
- https://render.com/docs/health-checks
- https://render.com/docs/free
- https://render.com/docs/node-version
- https://render.com/docs/blueprint-spec
- https://nodejs.org/en/about/previous-releases

Local validation evidence covers this project only. It is not a statement that STUDIO-5619 has passed in staging or production.
