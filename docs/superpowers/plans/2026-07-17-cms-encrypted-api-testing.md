# Encrypted CMS API Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a safe CMS-encrypted API testing asset type for the 51吃瓜白包测试 environment and seed documented read-only smoke cases.

**Architecture:** CmsCrypto owns AES-CBC, Base64 and signing; CmsApiRunner owns HTTP execution, decrypting, assertions and variable extraction; the existing run/store/report pipeline persists API evidence. Credentials live only in .env and are redacted at every reporting boundary.

**Tech Stack:** Node.js 22 crypto/fetch, Express 5, node:sqlite, Vitest, Supertest.

## Global Constraints

- Use CMS_BASE_URL, CMS_AES_KEY, CMS_AES_IV, CMS_APP_KEY, CMS_USERNAME and CMS_PASSWORD from .env only.
- API target accepts only explicit request definitions; Midscene never generates CMS write requests.
- readonly steps run normally; mutating steps require allowMutations true at run creation.
- Never store or return passwords, token values, AES material, app key or encrypted payload.
- White-bag test is the first configured environment.
- Use apply_patch and observe failing tests before production code.

---

### Task 1: CMS crypto and redaction primitives

Files: Create server/services/cms-crypto.js; Create tests/cms-crypto.test.js.

- [ ] Step 1: Write failing tests for encrypting a JSON payload to Base64 AES-128-CBC, decrypting the round trip, deterministic MD5(SHA256 data/timestamp/appKey) signing, and redactSecrets removing token/password/data/sign.
- [ ] Step 2: Run npm test -- tests/cms-crypto.test.js; verify module is absent.
- [ ] Step 3: Implement CmsCrypto with createCipheriv/createDecipheriv using aes-128-cbc, createHash for sha256 and md5, and URLSearchParams for timestamp/data/sign form body. Export encryptPayload, decryptPayload, buildRequestBody, decryptResponse and redactSecrets.
- [ ] Step 4: Run npm test -- tests/cms-crypto.test.js; verify pass.
- [ ] Step 5: Commit git add server/services/cms-crypto.js tests/cms-crypto.test.js && git commit -m "feat: add CMS crypto transport"

### Task 2: API case model and persistence

Files: Modify server/domain/case.js; Modify server/storage/sqlite-store.js; Modify tests/case.test.js; Modify tests/sqlite-store.test.js.

- [ ] Step 1: Write failing tests for target api case with steps containing request { action, method, payload, expectedStatus, expectedJson, extract, safety } and rejection of a non-POST CMS action or unknown safety.
- [ ] Step 2: Run npm test -- tests/case.test.js tests/sqlite-store.test.js; verify API target is rejected or request config is lost.
- [ ] Step 3: Extend target validation to web/api and store api request JSON in test_steps.request_json via idempotent schema migration. Keep Web UI fields valid only for web target.
- [ ] Step 4: Run npm test -- tests/case.test.js tests/sqlite-store.test.js; verify pass.
- [ ] Step 5: Commit git add server/domain/case.js server/storage/sqlite-store.js tests/case.test.js tests/sqlite-store.test.js && git commit -m "feat: persist API test assets"

### Task 3: CMS API runner and safety gate

Files: Create server/runners/cms-api-runner.js; Modify server/services/run-service.js; Create tests/cms-api-runner.test.js; Modify tests/run-service.test.js.

- [ ] Step 1: Write failing tests with mocked fetch for login token extraction, token injection, decrypted config/list response assertions, response variable extraction, and refusal to send mutating actions without allowMutations.
- [ ] Step 2: Run npm test -- tests/cms-api-runner.test.js tests/run-service.test.js; verify runner does not exist.
- [ ] Step 3: Implement CmsApiRunner.execute: interpolate payload, merge public parameters/token, encrypt/sign/send POST, decrypt data when crypt is true, assert HTTP/business status and JSON paths, extract variables, and return redacted request/response evidence. Make RunService dispatch by testCase.target and pass allowMutations only from explicit request.
- [ ] Step 4: Run npm test -- tests/cms-api-runner.test.js tests/run-service.test.js; verify pass.
- [ ] Step 5: Commit git add server/runners/cms-api-runner.js server/services/run-service.js tests/cms-api-runner.test.js tests/run-service.test.js && git commit -m "feat: run encrypted CMS API cases"

### Task 4: Environment wiring and seeded read-only assets

Files: Modify server/index.js; Modify server/app.js; Create server/seed/cms-whitebag-cases.js; Modify tests/app.test.js.

- [ ] Step 1: Write failing tests that health reports CMS configuration state, API runs use CmsApiRunner, and seed produces login/config/post/comment/member read-only cases without credentials.
- [ ] Step 2: Run npm test -- tests/app.test.js; verify state and seed are absent.
- [ ] Step 3: Load CMS environment values in index.js, construct CmsApiRunner, expose sanitized CMS readiness in health, and seed three read-only white-bag API cases only when no matching names exist. Do not run seeded cases automatically.
- [ ] Step 4: Run npm test -- tests/app.test.js; verify pass.
- [ ] Step 5: Commit git add server/index.js server/app.js server/seed/cms-whitebag-cases.js tests/app.test.js && git commit -m "feat: seed white-bag CMS API smoke cases"

### Task 5: API asset editor, dashboard and reports

Files: Modify index.html; Modify app.js; Modify style.css; Modify server/services/report-service.js; Modify tests/styles.test.js; Modify tests/app.test.js.

- [ ] Step 1: Write failing checks for API-specific asset routes/editor controls and API request/response report sections.
- [ ] Step 2: Run npm test -- tests/styles.test.js tests/app.test.js; verify controls are absent.
- [ ] Step 3: Add separate API asset list/filter and editor for action, JSON payload, expected status, JSON assertions and extraction. Add a dashboard execution-type segmented control with API metrics/logs. Report request action, duration, redacted request and response summary. Keep Web UI editor unchanged.
- [ ] Step 4: Run npm test -- tests/styles.test.js tests/app.test.js; verify pass.
- [ ] Step 5: Commit git add index.html app.js style.css server/services/report-service.js tests/styles.test.js tests/app.test.js && git commit -m "feat: manage CMS API test assets"

### Task 6: Verification and white-bag debug

- [ ] Step 1: Run npm test; expect zero failures.
- [ ] Step 2: Add local CMS values to untracked .env using the user-provided credentials and internal crypto material; do not commit it.
- [ ] Step 3: Start PORT=4182 npm start, verify health says CMS ready, then explicitly run only seeded read-only login/config/list cases against 51吃瓜白包测试.
- [ ] Step 4: Inspect reports for redaction and workbench API process panels at desktop and 390x844.
- [ ] Step 5: Run git diff --check && git status --short; expect no tracked secret files.
