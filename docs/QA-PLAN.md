# STUDIO-5619 - Senior QA execution plan

**Master test case:** QA-5619-001 - Complete URL outcome retrieval at scale.

**Objective:** A completed crawl with at least 15,000 valid source documents plus a known additional issue/edge cohort produces retrievable, correctly scoped URL outcomes with complete pagination, correct filters and no pipeline regression. Successful URLs, recovered retries and unchanged incremental URLs are excluded as required by the ticket.

**Actual status:** Not run in SearchStax/Datadog. Local fixture self-tests are documented separately. Do not convert those into a Jira acceptance pass.

The 15,000 valid URLs are never replaced by error pages. All 292 default additional fixtures are linked from the same mixed seed. The lifecycle tests below are subcases of the same master suite; a full crawl, its incremental follow-up, an isolated boundary crawl and provider-failure injection necessarily require different executions.

## Common preconditions

Deploy the server to your own Render Web Service. Record profile, commit/version, public origin, fixture boot ID, hosting plan/resources and environment variables. Use one instance. Reset before the initial mixed run, but do not reset/redeploy or manually consume retry GETs during it.

Use a dedicated authorized staging application/crawl definition with enough entitlement, item budget, depth and HTTP-error tolerance. Include `/valid`, `/cases` and `/crawl` in scope. Configure the intended exclusions, robots policy, retry policy, parser file types, size limit and timeout. Keep irrelevant whole-site sitemap discovery disabled for isolated profiles.

Record tenant/app/crawl-definition/run IDs and the run start/end time in UTC with your display timezone noted. Confirm each required failure was discovered and attempted, valid source documents were successfully parsed/indexed, the crawl finished, and provider ingestion settled. HTTP GET counts alone are not indexing evidence.

Do not assume that `FETCH`, `PARSE`, `INDEX`, `HTTP_404`, `DATA_UNAVAILABLE` or other illustrative strings in ticket discussion are the live enum values. Capture the actual versioned event and API contracts from the product team or a real authorized response.

## Expected dataset and counting rules

| Count | Default |
| --- | ---: |
| Valid document fixtures | 15,000 |
| Additional fixtures | 292 |
| Persistent HTTP-failure URLs | 200 |
| Additional conditional URLs | 92 |
| Mixed navigation pages | 87 |
| Fixture total, excluding navigation | 15,292 |
| Mixed HTML link graph, including seed/navigation | 15,379 |

Requests include retries, redirects, health/control requests and 304s; document/issue counts do not. The exact mixed final issue total is 200 plus whichever conditional URLs should be visible according to the confirmed contract. Do not invent an exact mixed count before resolving that policy. Existing valid redirect targets do not add new fixture URLs.

## Execution matrix

All actual results begin as **Not run**. Save evidence per subcase.

| ID | Scenario / additional precondition | Steps | Expected / evidence |
| --- | --- | --- | --- |
| S01 | Origin readiness and valid data | Verify health; run `verify --all-valid`; inspect first/middle/last and HTML discovery. | All 15,000 unique valid URLs return 200 on unconditional GET, with unique content markers. Manifest totals reconcile. This is source validation only. |
| S02 | Mixed full crawl, known outcomes | Start `/crawl`; use recorded settings; complete the crawl; reconcile discovery, actual attempts and final indexing. | All in-scope fixtures are considered; intentional failures/exclusions/redirects behave as configured. No silent stop from budget/depth/error threshold. Capture boot ID unchanged. |
| S03 | Complete cursor traversal | Query real issues API with `limit=10`; follow next_cursor without changing scope, limit or filters; collect to terminal cursor. | All expected affected URL identities returned exactly once. Zero missing, duplicate or unexpected URLs; unresolved conditional outcomes must be reviewed before sign-off. |
| S04 | Exact 25-issue boundary | Isolate `/crawl/boundary`; crawl to completion; collect with limit 10. | 25 persistent 404 URLs; pages 10, 10, 5; terminal cursor; no successful seed issue. No mixed-sitemap contamination. |
| S05 | Supported and invalid limits | Query with 1 and other documented valid limits; test 100 only if supported. Send -1, abc, 0 and above-max separately. | Valid sizes preserve the same complete URL set. Ticket QA notes expect clean 400 validation for invalid limits; confirm actual maximum and error contract. |
| S06 | URL search and intersections | Use blog/products strings, a unique suffix and a no-match string. Combine URL search with HTTP status and verified stage/code/result values. | Correct AND intersection; no valid-only documents leak into issues. Default persistent 404 cohort has 13 blog and 12 products URLs. Case/encoding behavior matches documented search semantics. |
| S07 | Each named filter | Independently test result, issue_code, pipeline_stage and http_status_code against known actual classifications. | Every row matches the exact selected field value and expected URL set. Empty results are distinguished from unavailable data. |
| S08 | Successful URLs excluded | After indexing succeeds, search issues for `/valid/` and sample exact valid URLs; inspect all pages. | No successful valid documents or successful navigation pages in the final issue list. Verify the index separately, not just HTTP 200. |
| S09 | Recovered retries excluded | After reset, let crawler GET retry fixtures; observe first 429/503 then successful retry and final index outcome. Collect final issues. | Recovered URLs absent. An intermediate attempt must not remain a final issue. If retry is disabled/exhausted, expect a final failure instead; do not claim recovery. |
| S10 | Unchanged incremental excluded | Complete baseline; keep content/version/validators unchanged; run incremental on the same definition. Inspect actual unchanged detection, then final issues. | Unchanged URLs absent. Conditional requests may produce 304; a crawler can also detect unchanged content another supported way. Stable source content alone does not prove the incremental outcome. |
| S11 | Configured exclusions / robots | Add the configured exclusion rule; honor robots; crawl mixed; inspect skipped/excluded outcomes and issue classification. Repeat ignore-robots as a distinct recorded variation. | Expected exclusions are not errors. Non-error visibility follows the actual endpoint contract. robots-blocked URLs are not fetched when rules are honored. |
| S12 | Working and failing redirects | Crawl all redirect families. Verify working final targets index; broken target fails; loop reaches the crawler limit. | Working redirects are not errors. Broken/loop outcomes are reported as required; source/target URL attribution follows the contract, with no duplicate URL outcomes. |
| S13 | Parser, noindex, timeout and size | Enable relevant extraction; configure timeout below delay and body threshold below payload. Inspect pipeline outcomes for the affected fixture paths. | Actual configured skips/failures have correct classifications/stages. A malformed MIME fixture may be skipped when extraction is disabled; do not label that a parser failure without evidence. |
| S14 | URL identity / duplicate discovery | Crawl encoded space, Unicode, case, long path, query keys and encoded plus. Inspect repeated/fragment links to `/valid/00001`. | No unintended duplicate records from repeated links/fragments. URL normalization and query identity match product policy; collector does not hide normalization differences. |
| S15 | Datadog provider parity | Feed equivalent standardized events to both authorized provider paths, or query the same completed event set where supported. Collect full reports and compare. | Equivalent URLs, result, code, stage and status; no missing/duplicate results. Both providers also satisfy the oracle; matching two equally incomplete sets is insufficient. |
| S16 | Missing / expired data | Use an authorized backend fixture/run whose observability data is absent or expired; query its real issues endpoint. | Explicit missing/expired/unavailable status per contract; never a misleading healthy empty list. Preserve response status/body and run context. |
| S17 | Provider outage / rate limit | Through an authorized backend stub or test configuration, make the observability provider return 429/503 or become unreachable. | Clear service/retry behavior, no fabricated zero-issue success. Provider 429 is distinct from a crawled website returning 429. No effect on unrelated tenants. |
| S18 | Invalid / reused cursor | Test malformed/expired cursor, another-run cursor, and documented behavior when changing filters/limit mid-traversal. | Clean documented rejection or safe behavior; no loop, cross-run data leakage or silently incomplete pass. Use fixed parameters for the completeness assertion. |
| S19 | Data scoping / authorization | Use QA users with different app/tenant access and two runs containing recognizable paths. Query the authorized real endpoint. | Correct isolation by tenant/app/run; no unauthorized issue disclosure. Record actual error contract without guessing one. |
| S20 | Pipeline regression / timing | Compare paired full crawls of identical corpus/configuration with and without concurrent issue retrieval; repeat, control origin resources and request policies. Verify discovery, parsing, schema mapping and Solr/search results. | No retrieval-induced stall/throttle beyond an agreed measurement criterion; normal pipeline functions intact. Ticket gives no numeric SLA, so record raw measurements and agree the threshold rather than invent one. |
| S21 | High affected-URL volume, optional | Set ISSUES_PER_STATUS=1500; update budgets/thresholds and oracle; complete authorized run; collect all pages. | 12,000 persistent failures remain retrievable in a 27,092-fixture corpus. Same deduplication/completeness rules; extra valid 15,000 remain valid. |
| S22 | Incomplete crawl / changing data | Stop a controlled run early or query while it is still emitting outcomes; document state. Recheck after completion and ingestion settles. | Incomplete discovery is not mistaken for a complete expected dataset. Do not assert snapshot equivalence during an evolving run unless the API explicitly guarantees it. |

## Acceptance-criteria traceability

| Ticket requirement | Subcases |
| --- | --- |
| At least 10,000 crawl URLs | S01, S02; default valid corpus alone has 15,000 |
| Complete pagination, no duplicates/missing results | S03-S05, S18, optional S21 |
| Exclude successful/recovered/unchanged outcomes | S08-S10 |
| Correct URL search and filters | S06-S07, S14 |
| Equivalent Datadog outcomes for equivalent input events | S15 |
| Clear missing/expired/unavailable status | S16-S17 |
| Normal pipeline unaffected | S20 |

## Backend-only fixtures and practical handoff

The website cannot directly create an indexer's schema rejection or retention state inside Datadog. For stage coverage and provider failures, request a **QA-only authorized harness** from the backend team with the real versioned event schema, correlation fields, supported provider selection, retention controls and failure injection. Keep synthetic events in a dedicated QA tenant/index with cleanup ownership. Do not infer that the website's own `qa_fixture.response` log proves the product emitted a standardized event.

For parity, require the same functional input events: successful fetch/parse/index; transient failure then recovery; terminal fetch failure; configured exclusion; working/failing redirect; unchanged incremental; parser rejection; indexer rejection. Preserve final-state precedence and tie-breaking semantics. Event timestamps, IDs or provider-specific metadata may differ; the final URL outcome fields must match according to the ticket.

Query actual operational events in Datadog only after inspecting a raw event and confirming its attribute names. Do not assume whether identifiers are named `app_id`, `application_id`, `crawl_id` or another schema key. Start from a known run/time range, then add the verified event-name and correlation filters. Missing search results can mean wrong field names, ingestion, scope or retention, not necessarily that no issues occurred.

## Throughput measurement protocol

Use the same corpus, crawler settings, event instrumentation, retry policies and hosting resources for each paired run. Compare retrieval-off and retrieval-on runs; reverse order and repeat to reduce cache/load bias. A healthy baseline and an intentionally failing mixed corpus are not equivalent workloads.

Capture wall-clock crawl duration, attempted URLs/sec, crawler queue depth, parser/indexer backlog, CPU/RSS, origin response latency/error rate, issue API page latencies and provider rate-limit responses. Keep stable-origin startup separate from cold-start overhead. The included issue collector measures client retrieval time and its own sampled RSS; backend memory/queue measurements come from platform observability.

For a performance run, retrieval can happen while crawling, but exact final pagination completeness should be evaluated again on a completed, settled run. Record the agreed tolerance for regression: it is not specified numerically in the ticket.

## Minimal evidence record

```text
Master case: QA-5619-001
Subcase:
Executed by / date:
Environment / tenant / app:
Crawl definition / run ID:
Fixture hostname / commit / boot ID / profile:
Crawler settings and entitlement:
Provider / event schema version / query time window:
Source manifest and conditional-resolution file:
Crawl completion and ingestion readiness evidence:
Indexed baseline verification:
Expected URL count / actual unique URL count:
Page sizes / missing / duplicates / unexpected:
Result: Pass | Fail | Blocked | Not run
Evidence: collector JSON, relevant responses/events, index query, measurements
Defect / blocker:
```

## Sign-off rule

Sign off only after the full expected URL set is reconciled, conditional policies are resolved, data availability is verified, Datadog equivalence is established and regression evidence is reviewed. A local origin test, a plausible dashboard count, an empty response or equal provider counts alone does not satisfy STUDIO-5619.
