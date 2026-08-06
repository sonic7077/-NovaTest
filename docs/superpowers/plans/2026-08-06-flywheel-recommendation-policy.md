# 飞轮推荐策略分析用例 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a reproducible Flywheel API case that samples interests from the supplied taxonomy, creates an isolated user profile, requests 20 recommendations, and reports strategy-policy analysis.

**Architecture:** Keep the existing `test_cases`/`test_steps` API asset model and `FlywheelApiRunner`. Add two structured request capabilities: deterministic random selection from bundled taxonomy values and a recommendation-policy analyzer. Store analyzer output inside the existing `run_steps.api_json`; extend HTML evidence rendering to show it. No new tables, endpoints, deletion calls, or model dependency.

**Tech Stack:** Node.js 22, native `fetch`, SQLite seed store, Vitest, existing HTML report renderer.

## Global Constraints

- Use only the supplied `taxonomy.json` as test-interest input; do not import it into the remote Flywheel taxonomy.
- Use a per-run user id and session id derived from `platformId` and `runId`.
- Random selection is deterministic for a given `runId`, selecting 1-3 distinct tag names.
- The feed request is `GET /api/v1/feed` with `size=20` and requires the existing Flywheel platform header.
- Mutating user upsert requires `allowMutations: true`; never call DELETE, reconcile, or taxonomy import.
- Preserve existing uncommitted Web UI changes and do not print or commit platform secrets.

---

### Task 1: Bundle and validate taxonomy-driven selection metadata

**Files:**
- Create: `server/seed/flywheel-taxonomy.json` (normalized copy of `/Users/zhangweiar/Downloads/taxonomy.json` containing `version` and `tags[].name`/`tag_id`/`parent_id`/`dimension`)
- Modify: `server/domain/case.js`
- Test: `tests/case.test.js`

**Interfaces:**
- Consumes: API request objects passed to `validateWebCase`.
- Produces: accepted `request.randomSelection` with `{ variable, values, minCount, maxCount }` and type-safe full-placeholder interpolation for array variables.

- [ ] **Step 1: Write the failing tests**

Add tests asserting that a Flywheel request accepts a random selection with 1-3 count bounds, rejects empty/duplicate values and invalid bounds, and that `interpolate('{{selectedInterests}}', { selectedInterests: ['A', 'B'] })` returns the array rather than a comma-joined string.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `npm test -- tests/case.test.js`

Expected: the new validation/interpolation assertions fail because `randomSelection` and typed full placeholders are not implemented.

- [ ] **Step 3: Implement the minimal validation and interpolation changes**

Add `validRandomSelection` to `server/domain/case.js`: require a non-empty variable name, a unique non-empty string `values` array of 1-500 entries, integer `minCount` in `[1,3]`, integer `maxCount` in `[minCount,3]`, and `values.length >= maxCount`. In `interpolate`, return the variable value unchanged when the entire string is one `{{name}}` token; keep nested strings and URL interpolation string-based.

- [ ] **Step 4: Run focused tests and confirm green**

Run: `npm test -- tests/case.test.js`

Expected: all case validation/interpolation tests pass.

- [ ] **Step 5: Commit the self-contained domain change**

Run:

```bash
git add server/domain/case.js tests/case.test.js server/seed/flywheel-taxonomy.json
git commit -m "feat: support taxonomy-driven flywheel selections"
```

---

### Task 2: Add deterministic interest selection and recommendation policy analysis

**Files:**
- Modify: `server/runners/flywheel-api-runner.js`
- Modify: `server/domain/case.js`
- Test: `tests/flywheel-api-runner.test.js`
- Create: `tests/report-service.test.js`

**Interfaces:**
- Consumes: `request.randomSelection` and `request.recommendationPolicy`.
- Produces: `execute()` returns `{ variables, api }`, where `api.analysis` contains selected tags, item counts, hit ratio, cap/floor checks, head-guard checks, duplicate checks, per-item match details, and observability notes.

- [ ] **Step 1: Write failing analyzer tests**

Add tests with mocked feed responses for: deterministic 1-3 selection across repeated execution with the same `runId`; a passing response whose first two items match and whose hit ratio is between 0.3 and 0.8; failure when the first two miss; failure below the hit floor; failure above the interest cap; duplicate `content_id`; malformed tags; and a short response that records `dataShortfall` without failing when it has at least one item.

- [ ] **Step 2: Run the focused tests and confirm red**

Run: `npm test -- tests/flywheel-api-runner.test.js`

Expected: new tests fail because the runner does not yet resolve random selections or produce policy analysis.

- [ ] **Step 3: Implement deterministic selection**

Add a small hash-based selector in `server/runners/flywheel-api-runner.js`. Hash `context.runId`, derive a count in `[minCount,maxCount]`, choose distinct indexes from `values`, and return `{ [variable]: selectedValues }`. Resolve the selection before payload interpolation so `onboarding_tags: '{{selectedInterests}}'` remains an array. Reuse existing variables on retries so selection is not regenerated.

- [ ] **Step 4: Implement policy analysis and evidence**

Add a structured analyzer that validates `items`, extracts each item’s string tags, computes exact tag intersection with the selected values, `hitCount`, `hitRatio`, `headGuard`, `interestCap`, `uniqueContentIds`, and `dataShortfall`. Treat zero items, malformed item/tag data, and hard policy violations as an error carrying the existing redacted `api` evidence plus `analysis`; return analysis with warnings for 1-19 items. Do not infer exploration from titles or `reason`; report `exploration: { status: 'unobservable', configuredRatio: 0.15 }` unless a declared response marker is present.

- [ ] **Step 5: Render policy analysis in reports**

Extend `server/services/report-service.js` `apiEvidenceMarkup` with a `推荐策略分析` details block when `api.analysis` exists. Pass the analysis through the existing secret redaction boundary and keep the request/response evidence unchanged.

- [ ] **Step 6: Run focused tests and confirm green**

Run: `npm test -- tests/flywheel-api-runner.test.js tests/case.test.js tests/report-service.test.js`

Expected: all focused tests pass, including existing API redaction and report assertions.

- [ ] **Step 7: Commit the runner and report behavior**

Run:

```bash
git add server/runners/flywheel-api-runner.js server/domain/case.js server/services/report-service.js tests/flywheel-api-runner.test.js tests/case.test.js tests/report-service.test.js
git commit -m "feat: analyze flywheel recommendation policy"
```

---

### Task 3: Seed the taxonomy-based recommendation case

**Files:**
- Modify: `server/seed/flywheel-cases.js`
- Test: `tests/flywheel-cases.test.js`

**Interfaces:**
- Consumes: bundled taxonomy values and runner capabilities from Tasks 1-2.
- Produces: `flywheel-recommendation-policy` API case in the 飞轮引擎 project.

- [ ] **Step 1: Write the failing seed test**

Assert a Chinese case named `正例：飞轮推荐策略-随机兴趣前20条分析` exists with two steps: a mutating `PUT /api/v1/users/{{platformId}}-novatest-{{runId}}` using `randomSelection`, and a readonly `GET /api/v1/feed` with `size: 20`, `session_id`, and a `recommendationPolicy` containing `FEED_TAG_HIT_FLOOR=0.3`, `FEED_INTEREST_CAP=0.8`, `EXPLORE_HEAD_GUARD=2`, and `POPULAR_LIMIT=20`.

- [ ] **Step 2: Run the seed test and confirm red**

Run: `npm test -- tests/flywheel-cases.test.js`

Expected: the new case lookup fails because the seed has not been added.

- [ ] **Step 3: Implement the minimal seed case**

Import the normalized taxonomy asset, expose its tag names to `randomSelection`, add the two structured requests, and use `request.expectedJson` only for response shape/`$.ok` checks. Do not add new projects or destructive steps.

- [ ] **Step 4: Run seed tests and confirm green**

Run: `npm test -- tests/flywheel-cases.test.js tests/case.test.js`

Expected: all seed and domain tests pass.

- [ ] **Step 5: Commit the seeded asset**

Run:

```bash
git add server/seed/flywheel-cases.js tests/flywheel-cases.test.js
git commit -m "feat: add flywheel recommendation policy case"
```

---

### Task 4: Seed SQLite, execute against the test service, and verify delivery

**Files:**
- Modify: `data/novatest.db` through the running service only (not Git)
- Create: `artifacts/novatest-data-<timestamp>.tar.gz` through `npm run package:data` (not Git)

**Interfaces:**
- Consumes: seeded case and configured Flywheel runtime in SQLite.
- Produces: an execution report URL and a deployable data package.

- [ ] **Step 1: Run the full automated regression**

Run: `npm test`

Expected: exit code 0 with all test files and tests passing.

- [ ] **Step 2: Restart the single local service on port 4173**

Confirm `lsof -nP -iTCP:4173 -sTCP:LISTEN`, restart only the agent-owned process if required, then confirm `GET /api/health` returns 200.

- [ ] **Step 3: Verify SQLite seed count and case structure**

Authenticate as local `admin`, query the 飞轮引擎 project, and confirm exactly one new policy-analysis case is present with two steps and no delete/reconcile action.

- [ ] **Step 4: Execute one real run with mutation authorization**

POST the case run with `{ "allowMutations": true }`; poll until terminal. Confirm the user upsert returns `$.ok=true`, the feed request is HTTP 200, and the report contains selected interests and policy analysis. A policy violation must be reported as failed with the full redacted response, not converted to passed.

- [ ] **Step 5: Verify report security and package data**

Assert the rendered report and serialized run evidence do not contain the configured platform key, run `git diff --check`, and run `npm run package:data`. Keep the generated database/package out of Git.

---

## Plan Self-Review

- Spec coverage: taxonomy input, stable random 1-3 selection, user upsert, feed size 20, all configured hard bounds, observability note for exploration, report evidence, no destructive operations, tests and real run are covered by Tasks 1-4.
- Placeholder scan: no TODO/TBD or unspecified implementation step remains.
- Interface consistency: `randomSelection`, `recommendationPolicy`, `api.analysis`, and the two-step seed case are named consistently across tasks.
- Known risk: the live test environment may return fewer than 20 items or violate its current policy; that is an observable test result and must not be hidden.
