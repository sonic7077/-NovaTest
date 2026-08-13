# 一日女友接口自动化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增“一日女友”项目、SQLite 运行配置、专用 REST 执行器和 110 条不产生资金或持久化业务变更的接口测试用例。

**Architecture:** 在现有 Composite API Runner 中注册 `daygf` 协议，并以项目运行配置提供测试基址与登录凭证。该 runner 在同一批次的共享 session 中只登录一次，将 JWT 同时写入 `x-token` 和 Bearer 头，支持结构化 JSON 请求、断言、变量提取与脱敏报告。用例继续使用 `test_cases` / `test_steps` 与既有项目、批量执行、报告能力，不增加数据库表。

**Tech Stack:** Node.js ESM、原生 `fetch`、SQLite、Express、Vitest。

## Global Constraints

- 测试环境固定为 `https://daygf.chenmoyuan.tech`，但基址和账户凭证只保存于 SQLite `runtime_config`。
- 源码、种子用例、报告和 Git 中不得出现测试账号密码、JWT 或 refresh token 明文。
- `daygf` 支持 `GET`、`POST`、`PUT`、`DELETE` 的 REST 定义；本期种子不使用任何 `DELETE`。
- 同批次一日女友 API 用例共享一次登录 session，非会话反例绝不触发登录。
- 真实充值、VIP/金币下单、支付回调、解锁、发布、上传、入驻、签约、下架、删除、改密与所有会造成持续数据改变的正向请求均不生成或执行。
- 商城仅允许只读配置、订单列表、流水和订单状态查询；高风险接口只允许无认证或非法参数反例。
- 新增用例总数精确为 110，全部属于“一日女友”项目、`target: api`、`protocol: daygf`。
- 不触碰当前未提交的 `server/runners/web-runner.js`、`tests/web-runner.test.js` 或未跟踪的 Web UI 产物。

---

### Task 1: 运行配置、协议校验和组合执行器注册

**Files:**
- Modify: `server/services/runtime-config-service.js`
- Modify: `server/services/runtime-services.js`
- Modify: `server/runners/composite-api-runner.js`
- Modify: `server/domain/case.js`
- Modify: `tests/helpers/runtime-config-fixture.js`
- Modify: `tests/runtime-config-service.test.js`
- Modify: `tests/runtime-services.test.js`
- Modify: `tests/composite-api-runner.test.js`
- Modify: `tests/case.test.js`

**Interfaces:**
- `normalizeRuntimeConfig(input).daygf` is optional and, when present, equals `{ baseUrl, username, password }`; `baseUrl` is normalized without a trailing slash.
- `runtimeConfigFromEnvironment(env)` imports the optional one-time bootstrap fields `DAYGF_BASE_URL`, `DAYGF_USERNAME`, `DAYGF_PASSWORD`.
- `createRuntimeServices(...).daygfBaseUrl` returns the configured base URL or `undefined`; `.daygfRunnerStatus` mirrors the existing optional runner status shape.
- `new CompositeApiRunner({ cms, editorial, flywheel, daygf })` routes `request.protocol === 'daygf'` to its isolated session.
- API case validation accepts `protocol: 'daygf'`, REST methods `GET|POST|PUT|DELETE`, `auth: session|none|invalid`, JSON assertions, extraction and list selection, while refusing all malformed definitions.

- [ ] **Step 1: Write failing normalization and validation tests**

Add these cases to `tests/runtime-config-service.test.js` and `tests/case.test.js`:

```js
it('normalizes optional 一日女友 runtime configuration', () => {
  const daygf = { baseUrl: 'https://daygf.example.test/', username: 'qa-user', password: 'qa-password' };
  expect(normalizeRuntimeConfig({ ...completeRuntimeConfig, daygf })).toMatchObject({
    daygf: { ...daygf, baseUrl: 'https://daygf.example.test' }
  });
});

it('accepts a 一日女友 REST request and rejects unsupported authentication', () => {
  const input = {
    id: 'daygf-me', projectId: 'daygf-project', name: '当前用户', target: 'api',
    baseUrl: 'https://daygf.example.test', viewport: 'desktop',
    steps: [{ id: 'me', kind: 'apiRequest', instruction: '查询当前用户', request: {
      protocol: 'daygf', action: '/api/me', method: 'GET', payload: {}, expectedStatus: 200,
      safety: 'readonly', expectedJson: [{ path: '$.ok', exists: true }]
    }}]
  };
  expect(validateWebCase(input).steps[0].request.protocol).toBe('daygf');
  expect(() => validateWebCase({ ...input, steps: [{ ...input.steps[0], request: { ...input.steps[0].request, auth: 'password' } }] })).toThrow('invalid API request');
});
```

Add a `createRuntimeServices` test that injects a spy `DaygfRunner` and expects it to receive `{ config: daygf }`; add a composite-runner test with an isolated `{ protocol: 'daygf' }` session.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- --run tests/runtime-config-service.test.js tests/runtime-services.test.js tests/composite-api-runner.test.js tests/case.test.js
```

Expected: new tests fail because `daygf` is unknown to normalization, runtime services, the composite runner and case validation.

- [ ] **Step 3: Implement the smallest configuration and routing surface**

In `server/services/runtime-config-service.js`, add:

```js
const daygfFields = ['baseUrl', 'username', 'password'];
// In normalizeRuntimeConfig:
const daygf = normalizeOptionalGroup(input.daygf, daygfFields, 'daygf', 'baseUrl');
// Return ...(daygf ? { daygf } : {})
// In runtimeConfigFromEnvironment:
const daygf = { baseUrl: env.DAYGF_BASE_URL, username: env.DAYGF_USERNAME, password: env.DAYGF_PASSWORD };
// Return ...(Object.values(daygf).some(Boolean) ? { daygf } : {})
```

Extend `apiProtocols` with `daygf`; give it the same documented REST method set as Flywheel, but do not allow Flywheel-only polling, random selection or recommendation policy. Extend valid auth only for `daygf` with `invalid`. In `CompositeApiRunner`, construct `this.runners = { cms, editorial, flywheel, daygf }`. In `createRuntimeServices`, instantiate `DaygfRunner` only when `config.daygf` exists, register it in `ApiRunner`, and return status and `daygfBaseUrl`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests pass; configuration error messages contain only the invalid field path, never submitted secret values.

- [ ] **Step 5: Commit the isolated configuration layer**

```bash
git add server/services/runtime-config-service.js server/services/runtime-services.js server/runners/composite-api-runner.js server/domain/case.js tests/helpers/runtime-config-fixture.js tests/runtime-config-service.test.js tests/runtime-services.test.js tests/composite-api-runner.test.js tests/case.test.js
git commit -m "feat: register daygf API runtime configuration"
```

### Task 2: 一日女友 REST 执行器与安全证据

**Files:**
- Create: `server/runners/daygf-api-runner.js`
- Modify: `server/services/runtime-services.js`
- Modify: `server/services/report-service.js`
- Create: `tests/daygf-api-runner.test.js`
- Modify: `tests/report-service.test.js`

**Interfaces:**
- `new DaygfApiRunner({ config, fetchImpl }).createSession()` returns an empty mutable session.
- `execute(step, context)` returns `{ variables, api }`, with `api = { action, method, httpStatus, durationMs, request, response }` and no credentials or tokens.
- `context.apiSession` stores `token`, `refreshToken`, `loginApi`, and `authenticationError` only for the active batch.
- `DaygfPreconditionError` has `code === 'PRECONDITION_UNAVAILABLE'` when a list-selection or extraction prerequisite is unavailable.
- `request.safety === 'mutating'` is blocked without `context.allowMutations`; the seed suite has no mutating steps.

- [ ] **Step 1: Write failing runner tests**

Create `tests/daygf-api-runner.test.js` with these concrete checks:

```js
it('logs in once and attaches the session token to two protected requests', async () => {
  const calls = [];
  const runner = new DaygfApiRunner({ config, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/login')) return response(200, { ok: true, token: 'private-jwt', refresh_token: 'private-refresh' });
    return response(200, { ok: true, id: 7 });
  }});
  const context = { testCase: { baseUrl: config.baseUrl }, variables: {} };
  await runner.execute(step('/api/me'), context);
  await runner.execute(step('/api/profile/data'), context);
  expect(calls).toHaveLength(3);
  expect(calls.slice(1).map(({ options }) => options.headers['x-token'])).toEqual(['private-jwt', 'private-jwt']);
  expect(calls.slice(1).map(({ options }) => options.headers.authorization)).toEqual(['Bearer private-jwt', 'Bearer private-jwt']);
});

it('does not authenticate a no-token negative probe', async () => {
  const calls = [];
  const runner = new DaygfApiRunner({ config, fetchImpl: async (url) => { calls.push(url); return response(401, { ok: false }); } });
  await runner.execute(step('/api/me', { auth: 'none', expectedStatus: 401 }), { testCase: { baseUrl: config.baseUrl }, variables: {} });
  expect(calls).toEqual(['https://daygf.example.test/api/me']);
});

it('redacts login credentials and both token forms from failed evidence', async () => {
  const runner = new DaygfApiRunner({ config, fetchImpl: async () => response(500, { token: 'private-jwt', nested: { refresh_token: 'private-refresh' } }) });
  await expect(runner.execute(step('/api/me'), { testCase: { baseUrl: config.baseUrl }, variables: {} })).rejects.toMatchObject({ api: expect.any(Object) });
});
```

Include explicit tests for GET query serialization, POST JSON serialization, `auth: invalid` (sends `invalid-token` without login), expected-status arrays, JSON extraction, list selection precondition skip, mutation authorization and non-JSON response evidence. In the failure test, assert serialized `error.api` contains none of `config.password`, `private-jwt`, or `private-refresh`.

- [ ] **Step 2: Run the runner tests and verify RED**

Run:

```bash
npm test -- --run tests/daygf-api-runner.test.js tests/report-service.test.js
```

Expected: module-not-found failure for `daygf-api-runner.js` and missing generic evidence label assertion.

- [ ] **Step 3: Implement `DaygfApiRunner`**

Implement focused helpers in `server/runners/daygf-api-runner.js`:

```js
const TOKEN_KEY_PATTERN = /(?:password|token|authorization|secret|credential)/i;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, TOKEN_KEY_PATTERN.test(key) ? '********' : redact(item)]));
  return value;
}

function restUrl(baseUrl, action, payload, method) {
  if (typeof action !== 'string' || !action.startsWith('/api/')) throw new Error(`invalid Daygf action: ${action}`);
  const base = new URL(baseUrl);
  const url = new URL(action, base);
  if (url.origin !== base.origin) throw new Error(`invalid Daygf action: ${action}`);
  if (method === 'GET' || method === 'DELETE') Object.entries(payload).forEach(([key, value]) => {
    (Array.isArray(value) ? value : [value]).filter((item) => item !== null && item !== undefined).forEach((item) => url.searchParams.append(key, String(item)));
  });
  return url.toString();
}
```

`authenticate` posts `{ username: config.username, password: config.password }` to `/api/login`, accepts a nonempty root `token`, stores only the token in session, and builds fully redacted `loginApi` evidence. For session requests, send `accept`, JSON content type for a body, `x-token`, and `authorization`. For `auth: invalid`, send the literal `invalid-token` in both headers but never authenticate. Reuse the established JSONPath/assert/extract/select behavior, with a `DaygfPreconditionError` for unavailable list data. Attach `error.api` for HTTP, parse, assertion and prerequisite failures.

Update `runtime-services.js` to import the runner and use it as the default injection. Update `report-service.js` to render `业务状态` only when `api.businessStatus !== undefined`; generic REST evidence must render `HTTP 200 · 12ms` without `undefined`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all Daygf runner and report tests pass, including redaction in both success and failure evidence.

- [ ] **Step 5: Commit the runner**

```bash
git add server/runners/daygf-api-runner.js server/services/runtime-services.js server/services/report-service.js tests/daygf-api-runner.test.js tests/report-service.test.js
git commit -m "feat: add daygf REST API runner"
```

### Task 3: 110 条一日女友测试资产与启动种子

**Files:**
- Create: `server/seed/daygf-cases.js`
- Modify: `server/index.js`
- Modify: `app.js`
- Create: `tests/daygf-cases.test.js`
- Modify: `tests/production-entry.test.js`
- Modify: `tests/app.test.js`

**Interfaces:**
- `daygfCases({ projectId, baseUrl })` returns exactly 110 API cases with stable IDs beginning `daygf-`.
- `seedDaygfCases(store, { baseUrl })` finds the project named `一日女友` and idempotently saves all 110 cases.
- `server/index.js` creates `一日女友` only when `services.daygfBaseUrl` is configured, then invokes the seed function with that runtime-only URL.
- The API editor presents `<option value="daygf">一日女友</option>` alongside existing protocols.

- [ ] **Step 1: Write a failing seed matrix test**

Create `tests/daygf-cases.test.js`:

```js
it('defines an exact 110-case read-only 一日女友 matrix with safe financial coverage', () => {
  const cases = daygfCases({ projectId: 'daygf-project', baseUrl: 'https://daygf.example.test' });
  const steps = cases.flatMap((testCase) => testCase.steps);
  expect(cases).toHaveLength(110);
  expect(cases.filter((testCase) => testCase.name.startsWith('正例：'))).toHaveLength(57);
  expect(cases.filter((testCase) => testCase.name.startsWith('反例：'))).toHaveLength(53);
  expect(cases.every((testCase) => testCase.projectId === 'daygf-project' && testCase.target === 'api')).toBe(true);
  expect(steps.every((step) => step.request.protocol === 'daygf')).toBe(true);
  expect(steps.some((step) => /shop\/(vip|coin)\/orders|shop\/pay\/callback|\/unlock/.test(step.request.action) && step.request.safety === 'mutating')).toBe(false);
  expect(steps.some((step) => step.request.method === 'DELETE')).toBe(false);
  expect(JSON.stringify(cases)).not.toMatch(/aaaa|111111|private-jwt/i);
});
```

Add assertions for the eight module totals `[18, 15, 17, 16, 16, 15, 8, 5]`, representative endpoint paths, no unsafe positive request, project-local idempotent upsert, production seed wiring, and API editor option. Add an app test rejecting a Daygf/CMS mixed-protocol batch before execution.

- [ ] **Step 2: Run seed and entry tests to verify RED**

Run:

```bash
npm test -- --run tests/daygf-cases.test.js tests/production-entry.test.js tests/app.test.js
```

Expected: missing seed module and absent production/editor option assertions.

- [ ] **Step 3: Implement a declarative, safe case factory**

Create a compact factory with one protocol constant and one step constructor:

```js
function requestStep(id, instruction, action, options = {}) {
  return { id, kind: 'apiRequest', instruction, request: {
    protocol: 'daygf', action, method: options.method || 'GET', payload: options.payload || {},
    expectedStatus: options.expectedStatus ?? 200, safety: options.safety || 'readonly',
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.expectedJson ? { expectedJson: options.expectedJson } : {}),
    ...(options.extract ? { extract: options.extract } : {}),
    ...(options.select ? { select: options.select } : {})
  }};
}
```

Implement stable case IDs and the exact matrix from the approved design:

```text
登录与会话 18: login/me/refresh/logout-safe probes, missing/empty/incorrect credentials, missing/invalid token
个人中心与收藏 15: profile-data/coins queries, invalid target/unauthenticated mutation probes, never unlock
视频内容 17: content list filters/pages/detail/comments/mine, missing ID, page boundary, unauthenticated write probes
动态 16: feed filters/pages/detail/comments/replies/mine, missing ID, page boundary, unauthenticated write probes
同城女友 16: list filters/pages/detail/mine, missing ID, page boundary, unauthenticated write probes
搜索与地区 15: search variants, history unauth probes, regions summary/provinces/streamer regions
商城只读 8: config/orders/ledger/status and only safe unauthenticated/unknown-order probes
公开主页与站点 5: public profile/works/home/ads/track config/page and unknown resource probe
```

All normal cases assert documented `ok`, collection or key-field existence only. Dynamic ID cases must first query a list and use `select`/`extract`; if no record exists they skip as a precondition, never substitute a live guessed ID. Make login itself a single `auth: none` negative/contract case; do not include a credential-bearing login seed because the runner owns session authentication.

Wire `seedDaygfCases` in `server/index.js` under `if (services.daygfBaseUrl)`, create the project as necessary, and add the editor option. Do not expose runtime configuration or credentials through the browser UI.

- [ ] **Step 4: Run seed and entry tests to verify GREEN**

Run the Step 2 command. Expected: exactly 110 cases, matching counts and safe operation constraints; project creation and seed execution are gated by SQLite runtime configuration.

- [ ] **Step 5: Commit test assets and seed wiring**

```bash
git add server/seed/daygf-cases.js server/index.js app.js tests/daygf-cases.test.js tests/production-entry.test.js tests/app.test.js
git commit -m "feat: seed one day girlfriend API cases"
```

### Task 4: SQLite persistence, real smoke verification and reporting evidence

**Files:**
- Modify: `tests/sqlite-store.test.js`
- Modify: `tests/batch-service.test.js`
- Modify: `tests/app.test.js`
- Modify only if a test exposes an integration defect: `server/services/batch-service.js`, `server/services/execution-service.js`, `server/services/report-service.js`
- Generated only: `data/novatest.db`, `data/evidence/`, `data-package/` or archive; never stage generated data.

**Interfaces:**
- SQLite persists `runtime_config.daygf` alongside existing CMS, Lighthouse, Editorial and Flywheel settings.
- A batch of Daygf cases creates one composite `daygf` session and causes exactly one `/api/login` request for multiple protected runs.
- Single and batch reports contain redacted request/response evidence for both pass and fail outcomes.

- [ ] **Step 1: Write failing SQLite and batch integration tests**

Add a SQLite test:

```js
it('persists optional 一日女友 configuration with existing runtime groups', async () => {
  const store = createSqliteStore({ databasePath });
  const daygf = { baseUrl: 'https://daygf.example.test', username: 'qa-user', password: 'qa-password' };
  store.saveRuntimeConfig({ ...completeRuntimeConfig, daygf });
  expect(store.getRuntimeConfig()).toMatchObject({ daygf });
});
```

Add a `BatchService` test using the real `DaygfApiRunner`, two protected API cases and a mocked fetch. Assert request actions equal `['/api/login', '/api/me', '/api/profile/data']`, batch status is passed, and every persisted step API evidence omits `qa-password`, `private-jwt`, and `private-refresh`. Add an app test that renders a failed API report and asserts its HTML includes request/response sections but none of those values.

- [ ] **Step 2: Run integration tests to verify RED**

Run:

```bash
npm test -- --run tests/sqlite-store.test.js tests/batch-service.test.js tests/app.test.js
```

Expected: new Daygf integration assertions fail until Tasks 1–3 are fully wired.

- [ ] **Step 3: Implement only integration fixes required by the tests**

Keep the shared-session mechanism as the existing `BatchService` contract:

```js
const apiSession = batch.target === 'api' && typeof apiRunner?.createSession === 'function'
  ? apiRunner.createSession()
  : undefined;
await this.batchService.execute({ batch, cases, apiSession });
```

Do not introduce a new table or a second login cache. If the test shows the generic report prints an undefined business status, retain the Task 2 conditional markup. Preserve existing CMS, Editorial and Flywheel behavior.

- [ ] **Step 4: Run focused integration tests and full regression**

Run:

```bash
npm test -- --run tests/sqlite-store.test.js tests/batch-service.test.js tests/app.test.js tests/daygf-api-runner.test.js tests/daygf-cases.test.js
npm test -- --run
```

Expected: both commands exit 0 with all existing tests retained.

- [ ] **Step 5: Start one local server and verify SQLite seeding**

Before starting, inspect whether port `4173` is already bound. Stop only the stale platform process, then run:

```bash
npm start
```

Verify `GET http://127.0.0.1:4173/api/health` and, after authenticating to the local platform, verify `/api/projects` includes `一日女友` and `/api/cases?projectId=<daygf-project-id>` returns 110 cases. Do not start a competing service on another port.

- [ ] **Step 6: Execute a safe read-only smoke batch and inspect its report**

Use only the seeded public/read-only cases (for example shop config, regions summary, content list and search) in one same-protocol batch. Poll the batch until terminal state. Inspect its report and confirm:

```text
1. A request/response evidence block exists for each completed API step.
2. Credentials, access token and refresh token are absent from persisted JSON and HTML.
3. Any externally unavailable data is marked skipped with a precondition reason, not passed.
4. No mutation, payment, unlock, order creation or delete endpoint was requested.
```

If external environment authentication fails, preserve the report as failure evidence and report it as an environment result; do not alter assertions or disable security behavior to force a pass.

- [ ] **Step 7: Package data without committing it and commit source changes**

Run:

```bash
npm run package:data
git add tests/sqlite-store.test.js tests/batch-service.test.js tests/app.test.js
git commit -m "test: verify daygf API batch isolation"
git status --short
```

Verify the generated data package contains the SQLite database and deployment README. Leave database, evidence and archive files untracked; only source, tests and design documents belong in Git.
