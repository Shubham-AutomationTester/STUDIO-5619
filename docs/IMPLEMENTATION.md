# Implementation notes

## Small repository, large deterministic site

The server uses Node's standard HTTP, filesystem and crypto modules. No Express install, framework compilation, database or third-party runtime package is required. `npm ci` reads the included lockfile; `npm start` launches `server.mjs`. Render uses the same commands.

The catalog produces exactly 15,000 unique valid paths in memory. HTML is rendered on demand and includes a unique ID/marker, title, body and canonical link. Listing pages contain real HTML anchors, so JavaScript execution is not needed for discovery. The admin dashboard is separate from the crawl graph.

The mixed graph has one seed, 60 valid-document listing pages and 26 case-group listing pages: 87 navigation pages. Every ordinary document is reachable in two link hops from the seed. An extra repeated anchor and a fragment anchor reuse `/valid/00001`; they do not create extra fixture identities.

The mixed sitemap index has three 5,000-valid-URL shards and one cases shard. Query-string ampersands are XML-escaped. Profile-specific indexes avoid requiring one large HTML page with 15,000 links.

## Determinism and state

Valid/incremental HTML is independent of the current request time and boot ID. ETags hash actual HTML, and Last-Modified is configured. If-None-Match takes precedence over If-Modified-Since; weak ETags are accepted for GET/HEAD comparison. 304 is returned only when validators match, never merely because a fixture is named incremental.

The retry map is per exact fixture path, shared across visitors within one process. Only GET consumes attempts; HEAD returns the current status without advancing the sequence. This choice prevents URL validation HEAD probes from silently consuming the retry case, but a GET-based preflight does consume it. Reset immediately before the test and attribute real GETs to the crawler using its events plus origin observations.

Counters are in-memory and deliberately not described as durable. Reset creates a new boot/reset identifier. Deploy/restart creates a fresh identifier too. Use one process/instance and avoid concurrent test runs on the same fixture service. For concurrent independent stateful tests, deploy separate services or extend state partitioning with an authorized run namespace/shared store.

State stores only known fixture paths and status aggregates, not arbitrary incoming URLs, IPs, user agents, credentials or full unbounded request histories. Enable REQUEST_LOGGING to emit per-response origin logs if required; it changes workload overhead and must be held constant during performance comparisons.

## Real protocol behaviors

Persistent failure fixtures return actual 4xx/5xx responses. Redirects use real Location headers. robots.txt rules and X-Robots-Tag headers are real. Timeout fixtures delay response headers without blocking the Node event loop; concurrent pending delayed responses are capped at 20. That guard returns 429 when full and is a fixture-capacity condition, not the intended crawler timeout outcome.

The parser-invalid fixture is intentionally not a PDF document: it serves invalid text bytes under the application/pdf MIME type to exercise extraction error handling. It is not a malformed HTML guarantee and it does not force any particular parser implementation to emit an issue. The size fixture emits actual large HTML; configured crawler size policy controls its outcome.

## Separation of concerns

`/api/config`, `/api/manifest`, `/api/stats` and `/api/observations` describe the fixture server. Their fields and pagination are not SearchStax APIs. `/admin/reset` only changes fixture state and requires POST plus a bearer token matching ADMIN_TOKEN. When the token is unset, reset is disabled.

The dashboard never automatically requests scenario pages, so viewing it does not consume retry failures. Only control/config/stats endpoints are fetched automatically. The dashboard makes no assertion that product testing passed.

The real issues collector is separate, executed locally using the configured staging endpoint and authentication from environment variables. Its schema paths are configurable because the Jira content does not establish the full HTTP contract. Unit-test enums and synthetic servers are explicitly local fixtures, not a substitute for real provider tests.

## Security and operation

Use a dedicated QA origin, not a customer/production site. Keep tokens out of source control. The public dashboard reveals fixture paths/configuration but no admin secret. Authentication is required for resets; no external request proxy or arbitrary URL fetch endpoint exists. No CORS allowance is enabled for cross-origin browser calls.

Absolute public links use BASE_URL, then RENDER_EXTERNAL_URL, then the request origin. Production deployments should use a trusted configured origin. Large-body and delay limits are bounded; the site is not an unrestricted traffic generator. The exhaustive verification CLI is an opt-in request load against the operator's own test site.

A local origin PASS does not certify Render proxy behavior, SearchStax parsing, index identity, entitlement, event generation, Datadog retention or the issue retrieval endpoint. Re-run readiness checks after deployment and use the accompanying QA plan.
