# BY Full API Negative Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 BY 公共 Web/H5 与管理后台已知接口整理为不少于 220 条可追溯的正例、反例和边界自动化用例，并支持批次内一次登录、Token 复用、敏感数据脱敏和高风险操作隔离。

**Architecture:** 保留现有 `by` 公共 API runner，新增加 `byAdmin` 协议与独立 `ByAdminApiRunner`。两种协议复用既有 API 用例结构、CompositeApiRunner、SQLite 用例存储和报告证据；后台 runner 在批次上下文内维护内存认证会话，变更操作由 `safety` 与显式 `allowMutations` 双重控制。种子模块按接口矩阵生成稳定 ID，用例启动时幂等覆盖到现有 BY 项目。

**Tech Stack:** Node.js 22、Express、SQLite、原生 `fetch`、Vitest、现有 `CompositeApiRunner` 与 `server/seed/by-cases.js`。

## Global Constraints

- BY 后台测试环境固定为 `https://by.chenmoyuan.tech`，后台路径前缀为 `/admin-api/v1`。
- 用例总数不少于 220 条，且 ID 唯一、项目归属为“BY项目”。
- JWT、TOTP、密码、联系方式、第三方密钥和图片 Token 不写入用例、SQLite、报告或 Git。
- `DELETE`、支付回调、Telegram 外部连接/验证码/同步/频道发送、密码重置和 2FA 重置只生成跳过型资产，不发起请求。
- 受控变更正例只有在执行上下文明确 `allowMutations: true` 时才允许发起。
- 缺少后台认证配置时，认证依赖用例必须返回明确跳过原因，不能伪造通过或失败。
- 先写失败测试并确认失败，再写最小实现；每个任务完成后运行对应测试。

---

### Task 1: 扩展 BY Admin 协议领域校验

**Files:**
- Modify: `/Users/zhangweiar/Documents/软件测试自动化平台/server/domain/case.js`
- Test: `/Users/zhangweiar/Documents/软件测试自动化平台/tests/case.test.js`

**Interfaces:**
- Consumes: existing `validateWebCase` API request validation.
- Produces: `protocol: 'byAdmin'`, methods `GET|POST|PUT|PATCH`, `auth: none|session|invalid`, and optional `skipReason`/`requiresAuth` metadata accepted by API cases.

- [ ] **Step 1: Write the failing test**

Add tests asserting that a valid `byAdmin` request is accepted, a `DELETE` request is rejected, and a request with a non-admin path is rejected:

```js
it('accepts a BY admin request and rejects unsafe paths or DELETE', () => {
  const base = {
    id: 'by-admin-auth-info', projectId: 'p1', name: '后台当前账号查询',
    baseUrl: 'https://by.chenmoyuan.tech', target: 'api', viewport: 'desktop',
    steps: [{ id: 's1', kind: 'apiRequest', instruction: '查询当前账号', request: {
      protocol: 'byAdmin', action: '/admin-api/v1/auth/info', method: 'GET',
      expectedStatus: 200, expectedCode: undefined, safety: 'readonly', auth: 'session'
    }}]
  };
  expect(() => validateWebCase(base)).not.toThrow();
  expect(() => validateWebCase({ ...base, steps: [{ ...base.steps[0], request: { ...base.steps[0].request, method: 'DELETE' } }] })).toThrow('invalid API request');
  expect(() => validateWebCase({ ...base, steps: [{ ...base.steps[0], request: { ...base.steps[0].request, action: '/c-api/v1/members' } }] })).toThrow('invalid API request');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/case.test.js -t "BY admin request"`

Expected: FAIL because `byAdmin` is not in `apiProtocols` and the path/method rules do not exist.

- [ ] **Step 3: Write minimal implementation**

Update `apiProtocols` to include `'byAdmin'`, add `validMethod` support for `GET|POST|PUT|PATCH`, allow `auth` values `none|session|invalid`, and reject `DELETE` and actions that do not match `/admin-api/v1/...` when protocol is `byAdmin`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/case.test.js -t "BY admin request"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/case.js tests/case.test.js
git commit -m "feat: validate BY admin API cases"
```

### Task 2: Implement ByAdminApiRunner and session reuse

**Files:**
- Create: `/Users/zhangweiar/Documents/软件测试自动化平台/server/runners/by-admin-api-runner.js`
- Modify: `/Users/zhangweiar/Documents/软件测试自动化平台/server/services/runtime-services.js`
- Modify: `/Users/zhangweiar/Documents/软件测试自动化平台/server/runners/composite-api-runner.js`
- Test: `/Users/zhangweiar/Documents/软件测试自动化平台/tests/by-admin-api-runner.test.js`
- Test: `/Users/zhangweiar/Documents/软件测试自动化平台/tests/composite-api-runner.test.js`

**Interfaces:**
- Consumes: `step.request`, `context.testCase.baseUrl`, `context.allowMutations`, `context.apiSession`, and optional `context.byAdminConfig`.
- Produces: `ByAdminApiRunner.execute(step, context) -> { variables, api }`, `createSession() -> { token: undefined, loginCount: 0, refreshCount: 0 }`, and `byAdmin` routing in `CompositeApiRunner`.

- [ ] **Step 1: Write the failing tests**

Create tests with a fake fetch that returns login, authenticated info, and a 401 followed by refresh. Assert one login for two authenticated steps and no secret in evidence:

```js
it('logs in once and reuses the token within one API session', async () => {
  const calls = [];
  const runner = new ByAdminApiRunner({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/login')) return jsonResponse({ token: 'jwt-secret', expireAt: 9999999999 });
    return jsonResponse({ id: 1, username: 'operator' });
  }});
  const context = adminContext(runner);
  await runner.execute(adminStep('/admin-api/v1/auth/info'), context);
  await runner.execute(adminStep('/admin-api/v1/auth/routes'), context);
  expect(calls.filter((call) => call.url.endsWith('/auth/login'))).toHaveLength(1);
  expect(calls[1].options.headers.authorization).toBe('Bearer jwt-secret');
});
```

Also assert mutating steps reject without `allowMutations`, invalid cross-origin actions reject before fetch, and a 401 performs at most one recovery.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/by-admin-api-runner.test.js tests/composite-api-runner.test.js`

Expected: FAIL because the runner file and `byAdmin` route do not exist.

- [ ] **Step 3: Write minimal implementation**

Implement same-origin URL construction for `/admin-api/v1`, JSON/query encoding, browser User-Agent, redaction for authorization/password/token/TOTP/contact/secret fields, login response token extraction, in-memory token reuse, one refresh/relogin on 401, and `allowMutations` enforcement. Do not log or persist credentials. Register `ByAdminApiRunner` in `createRuntimeServices` and pass it to `CompositeApiRunner`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/by-admin-api-runner.test.js tests/composite-api-runner.test.js`

Expected: PASS with login count exactly one for the reuse scenario.

- [ ] **Step 5: Commit**

```bash
git add server/runners/by-admin-api-runner.js server/services/runtime-services.js server/runners/composite-api-runner.js tests/by-admin-api-runner.test.js tests/composite-api-runner.test.js
git commit -m "feat: add BY admin API runner with session reuse"
```

### Task 3: Add BY runtime authentication configuration

**Files:**
- Modify: `/Users/zhangweiar/Documents/软件测试自动化平台/server/services/runtime-config-service.js`
- Modify: `/Users/zhangweiar/Documents/软件测试自动化平台/server/storage/sqlite-store.js`
- Test: `/Users/zhangweiar/Documents/软件测试自动化平台/tests/runtime-config-service.test.js`
- Test: `/Users/zhangweiar/Documents/软件测试自动化平台/tests/sqlite-store.test.js`

**Interfaces:**
- Consumes: existing SQLite runtime configuration normalization and persistence.
- Produces: optional `config.byAdmin = { baseUrl, username, password, totpSecret }`, with secrets write-only/masked in read responses and no hard-coded defaults.

- [ ] **Step 1: Write the failing test**

Add a normalization test for a configured BY admin base URL and a persistence test that reads back the non-secret fields while masking the password and TOTP secret.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runtime-config-service.test.js tests/sqlite-store.test.js -t "BY admin"`

Expected: FAIL because the config schema has no `byAdmin` section.

- [ ] **Step 3: Write minimal implementation**

Extend normalization and SQLite runtime config serialization with optional `byAdmin` values. Preserve existing config records; omit the section when no credentials are configured. Ensure API responses expose only masked placeholders and never return the original secret values.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/runtime-config-service.test.js tests/sqlite-store.test.js -t "BY admin"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/runtime-config-service.js server/storage/sqlite-store.js tests/runtime-config-service.test.js tests/sqlite-store.test.js
git commit -m "feat: persist optional BY admin runtime config"
```

### Task 4: Generate 220+ public and admin case assets

**Files:**
- Create: `/Users/zhangweiar/Documents/软件测试自动化平台/server/seed/by-admin-cases.js`
- Modify: `/Users/zhangweiar/Documents/软件测试自动化平台/server/seed/by-cases.js`
- Modify: `/Users/zhangweiar/Documents/软件测试自动化平台/server/index.js`
- Test: `/Users/zhangweiar/Documents/软件测试自动化平台/tests/by-cases.test.js`
- Test: `/Users/zhangweiar/Documents/软件测试自动化平台/tests/by-admin-cases.test.js`

**Interfaces:**
- Consumes: `byCases({ projectId, baseUrl })`, `seedByCases`, API case validation, and stable project lookup.
- Produces: `byAdminCases({ projectId, baseUrl })`, `seedByAdminCases`, and combined BY seed count `>= 220` with unique IDs.

- [ ] **Step 1: Write the failing tests**

Add assertions that combined public/admin seed count is at least 220, IDs are unique, every case belongs to BY project, protocols are correct, and at least 20 high-risk cases carry `skipReason` or `safety: 'mutating'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/by-cases.test.js tests/by-admin-cases.test.js`

Expected: FAIL because the current public seed is below 220 and the admin seed does not exist.

- [ ] **Step 3: Write minimal implementation**

Create deterministic case builders from the documented route matrix. Generate public cases for every query and body constraint using a bounded input corpus (`'', ' ', 0, -1, 61, 101, Unicode, emoji, replacement character, encoded delimiters, and limited SQL/XSS feature strings`). Generate admin cases for authentication, members, push, articles/reports, files/contact access, site settings, stats/logs, RBAC, Telegram and orders. Mark `DELETE`, payment callback, external Telegram, password/2FA reset and other high-risk cases with `skipReason: '高风险操作需要独立授权'` and `safety: 'mutating'`; do not include credentials in payloads. Update `server/index.js` to seed the admin cases into the existing BY project and update the existing `byCases` seeding path to preserve idempotency.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/by-cases.test.js tests/by-admin-cases.test.js`

Expected: PASS with a combined count of at least 220 and no duplicate IDs.

- [ ] **Step 5: Commit**

```bash
git add server/seed/by-admin-cases.js server/seed/by-cases.js server/index.js tests/by-cases.test.js tests/by-admin-cases.test.js
git commit -m "feat: seed BY full API negative matrix"
```

### Task 5: Add report behavior for skipped high-risk admin assets

**Files:**
- Modify: `/Users/zhangweiar/Documents/软件测试自动化平台/server/services/run-service.js`
- Modify: `/Users/zhangweiar/Documents/软件测试自动化平台/server/services/report-service.js`
- Test: `/Users/zhangweiar/Documents/软件测试自动化平台/tests/run-service.test.js`
- Test: `/Users/zhangweiar/Documents/软件测试自动化平台/tests/report-service.test.js`

**Interfaces:**
- Consumes: case-level `skipReason`, existing `allowMutations` execution context, and report summary grouping.
- Produces: explicit `skipped` result with reason for high-risk assets and no network call when authorization is absent.

- [ ] **Step 1: Write the failing test**

Add a run-service test that submits a high-risk BY admin case without `allowMutations` and expects status `skipped`, reason `高风险操作需要独立授权`, and zero runner calls. Add a report test asserting the skipped group displays this reason.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/run-service.test.js tests/report-service.test.js -t "high-risk"`

Expected: FAIL because current execution treats the case as an ordinary API step.

- [ ] **Step 3: Write minimal implementation**

Short-circuit at run-service before runner dispatch when a case has `skipReason` and mutation authorization is absent. Keep the result in the planned total and report skipped group; preserve existing API failure evidence behavior for ordinary cases.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/run-service.test.js tests/report-service.test.js -t "high-risk"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/run-service.js server/services/report-service.js tests/run-service.test.js tests/report-service.test.js
git commit -m "feat: report high-risk BY assets as skipped"
```

### Task 6: SQLite seed, full regression and data package verification

**Files:**
- Modify: `/Users/zhangweiar/Documents/软件测试自动化平台/data/novatest.db`
- Test: `/Users/zhangweiar/Documents/软件测试自动化平台/tests/by-full-matrix.test.js`
- Verify: `/Users/zhangweiar/Documents/软件测试自动化平台/server/commands/package-data.js`

**Interfaces:**
- Consumes: combined seed functions, SQLite store, existing data packaging command.
- Produces: persisted BY project assets, a reproducible count check, and a deployable data package without credentials.

- [ ] **Step 1: Write the failing test**

Create an integration test that opens a temporary SQLite database, creates/loads the BY project, calls both seed functions, reloads the database, and asserts at least 220 assets, unique IDs, and no payload keys matching `password|token|secret|contact|authorization` with non-masked values.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/by-full-matrix.test.js`

Expected: FAIL because the combined seed and persistence are not implemented.

- [ ] **Step 3: Write minimal implementation**

Use the existing SQLite store and startup seed path; do not add a second database or JSON source of truth. Run `npm run package:data` and ensure the generated package includes SQLite data but excludes runtime secrets, evidence and report artifacts.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/by-full-matrix.test.js && npm test && npm run package:data`

Expected: the focused test passes, the complete suite is green, and packaging completes without secret-scan failures.

- [ ] **Step 5: Commit**

```bash
git add data/novatest.db tests/by-full-matrix.test.js
git commit -m "test: persist and package BY full API matrix"
```

## Final Verification Checklist

- [ ] `npx vitest run tests/case.test.js tests/by-admin-api-runner.test.js tests/by-cases.test.js tests/by-admin-cases.test.js tests/by-full-matrix.test.js` passes.
- [ ] `npm test` passes with no new failures.
- [ ] `npm run package:data` completes and its output contains no plaintext credentials or tokens.
- [ ] Local service starts on `http://127.0.0.1:4173` and `/api/health` reports BY public and admin runners ready/unconfigured as expected.
- [ ] SQLite BY project contains at least 220 unique API cases after a restart.
- [ ] No high-risk case sends a request without explicit mutation authorization.
