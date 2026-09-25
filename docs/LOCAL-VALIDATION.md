# Local verification evidence

This verifies the delivered fixture project, **not the SearchStax ticket in staging/production**.

| Check | Result |
| --- | --- |
| Automated Node tests | 35 passed; 0 failed |
| All valid document URLs over local HTTP | 15,000 checked; 15,000 passed |
| Origin verifier checks including protocol samples | 15,020 checked; 0 failures |
| HTML-only discovery | Every one of the 15,292 fixture paths reachable; 87 navigation pages |
| Sitemap shards | 15,292 unique fixture URLs, no duplicates |
| Local collector scale test | 10,005 synthetic outcomes over 1,001 pages, no loss/duplicates |
| Boundary collector test | 25 synthetic outcomes with page sizes 10, 10, 5 |
| Oracle-export CLI | Mixed counts 200 required / 15,087 forbidden / 92 conditional; boundary 25; 404 + blog subset 13 |
| Dashboard rendering | Offline desktop/mobile rendering; 26 scenario groups; search works; no JS errors or horizontal mobile overflow |

Runtime used: Node.js v22.16.0. Node 24 is selected for Render; the GitHub workflow defines Node 22 and 24 jobs, but those hosted CI jobs have not been executed here.

Full origin HTTP check timestamp: `2026-09-25T14:34:56.930Z` through `2026-09-25T14:35:01.014Z`. The local loopback run used concurrency 8 and a 1 ms worker pause. Its duration is a local fixture check, **not a hosted-performance benchmark or crawler SLA**.

The browser environment blocks live localhost navigation, so visual inspection used the actual HTML/CSS/JavaScript with captured local config/stats responses. This validates offline rendering and scenario filtering, not a live deployed browser session. Origin HTTP requests, redirects, validators, retry behavior and reset authorization were exercised independently by the Node tests and verifier.

Evidence files: `local-unit-tests.tap`, `local-origin-verification.json`, `local-ui-verification.json`. `dashboard-preview.png` is an offline rendering of the local dashboard after HTTP checks; its origin counts are not indexed-document counts.

## Not executed here

GitHub upload; Render deployment/proxy behavior; real SearchStax discovery/parser/indexer execution; real issues-endpoint schema/auth adaptation; actual Datadog/default-provider parity or availability/failure injection; application entitlements; production performance. Use the README and QA plan in the target environment. All product acceptance results remain **Not run**.
