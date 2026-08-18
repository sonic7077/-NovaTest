# BY Public API Test Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the BY project with executable, evidence-producing Web/H5 public API regression cases while keeping all state-changing requests opt-in.

**Architecture:** Add a focused `by` REST runner that accepts only same-origin `/c-api/v1` actions and validates both HTTP status and the BY `{ code, msg, data }` envelope. Register it in the existing composite API runner, seed a stable BY project with idempotent public-interface assets, and retain request/response redaction in the common report path.

**Tech Stack:** Node.js 22, Express, native `fetch`, Vitest, SQLite, existing composite API runner and case seed pattern.

## Global Constraints

- BY tests use `https://by.chenmoyuan.tech` with relative `/c-api/v1/...` actions only.
- Do not add or store administrator credentials, JWTs, TOTP secrets, image tokens, encrypted image bytes, or contact details.
- Send a normal browser User-Agent with every BY request.
- Assert both the HTTP status and the BY response `code`; preserve redacted request and response evidence for failures.
- Tag a successful `POST /c-api/v1/reports` request as `mutating`; require `allowMutations: true` to execute it.
- Do not add management-backend, delete, payment callback, Telegram connection, or external push requests in this change.

---

### Task 1: Define the BY case request contract

**Files:**
- Modify: `server/domain/case.js`
- Modify: `tests/case.test.js`

**Interfaces:**
- Produces `protocol: 'by'` as a valid API protocol.
- Produces `request.expectedCode: number | number[] | undefined` for BY business-envelope assertions.
- Consumes the existing `validateWebCase(input)` validation entry point.

- [ ] **Step 1: Write failing BY validation tests**

Add these tests to `tests/case.test.js`:

```js
it('accepts a BY public API request with an expected business code', () => {
  const testCase = validateWebCase({
    id: 'by-members', projectId: 'by-project', name: '会员列表', target: 'api',
    baseUrl: 'https://by.example.test', viewport: 'desktop',
    steps: [{ id: 'members', kind: 'apiRequest', instruction: '查询会员', request: {
      protocol: 'by', action: '/c-api/v1/members', method: 'GET', payload: { page: 1 },
      expectedStatus: 200, expectedCode: 0, safety: 'readonly', auth: 'none'
    } }]
  });
  expect(testCase.steps[0].request.protocol).toBe('by');
});

it('rejects a BY request without a numeric expected business code', () => {
  expect(() => validateWebCase({
    id: 'by-invalid', projectId: 'by-project', name: '异常', target: 'api',
    baseUrl: 'https://by.example.test', viewport: 'desktop',
    steps: [{ id: 'bad', kind: 'apiRequest', instruction: '查询', request: {
      protocol: 'by', action: '/c-api/v1/members', method: 'GET', payload: {},
      expectedStatus: 200, expectedCode: '0', safety: 'readonly', auth: 'none'
    } }]
  })).toThrow('invalid API request');
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm test -- tests/case.test.js`

Expected: the first test fails because `by` is not an accepted protocol.

- [ ] **Step 3: Implement minimal BY contract validation**

In `server/domain/case.js`:

```js
const apiProtocols = new Set(['cms', 'editorial', 'flywheel', 'daygf', 'by']);

function validExpectedCode(value, protocol) {
  if (protocol !== 'by') return value === undefined;
  const codes = Array.isArray(value) ? value : [value];
  return codes.length > 0 && codes.every(Number.isInteger);
}
```

Extend the API-request validation condition so BY accepts `GET` and `POST`, accepts only `auth: 'none'` or omitted auth, and requires `validExpectedCode(request.expectedCode, protocol)`.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `npm test -- tests/case.test.js`

Expected: exit code 0 with all case validation tests passing.

- [ ] **Step 5: Commit the contract change**

```bash
git add server/domain/case.js tests/case.test.js
git commit -m "feat: validate BY public API requests"
```

### Task 2: Implement the BY public API runner

**Files:**
- Create: `server/runners/by-api-runner.js`
- Create: `tests/by-api-runner.test.js`

**Interfaces:**
- Produces `ByApiRunner` with `createSession()` and `execute(step, context)`.
- Consumes a BY request object with `action`, `method`, `payload`, `expectedStatus`, `expectedCode`, `expectedJson`, `extract`, `safety`, and `auth`.
- Returns `{ variables, api }`, where `api` has `action`, `method`, `httpStatus`, `businessStatus`, `durationMs`, redacted `request`, and redacted `response`.

- [ ] **Step 1: Write failing runner tests**

Create `tests/by-api-runner.test.js` with helper functions returning mocked JSON `Response` objects and these tests:

```js
it('encodes a public list query with a browser user agent and validates code 0', async () => {
  const fetchImpl = vi.fn(async (url, init) => {
    expect(url).toBe('https://by.example.test/c-api/v1/members?page=1&pageSize=2');
    expect(init.headers['user-agent']).toMatch(/Mozilla\/5\.0/);
    return response(200, { code: 0, msg: 'ok', data: { list: [], total: 0 } });
  });
  const runner = new ByApiRunner({ fetchImpl });
  const result = await runner.execute(byStep('/c-api/v1/members', { payload: { page: 1, pageSize: 2 } }), byContext());
  expect(result.api).toMatchObject({ httpStatus: 200, businessStatus: 0 });
});

it('records redacted evidence when the business code differs', async () => {
  const runner = new ByApiRunner({ fetchImpl: async () => response(200, { code: 40000, msg: '参数错误', data: { contact: 'private' } }) });
  await expect(runner.execute(byStep('/c-api/v1/reports', { method: 'POST', payload: { contact: 'private' }, expectedCode: 0 }), byContext()))
    .rejects.toMatchObject({ message: 'BY business assertion failed: /c-api/v1/reports', api: { response: { data: { contact: '********' } } } });
});

it('rejects cross-origin, non-BY, and mutation requests before fetching', async () => {
  const fetchImpl = vi.fn();
  const runner = new ByApiRunner({ fetchImpl });
  await expect(runner.execute(byStep('https://evil.example.test/c-api/v1/members'), byContext())).rejects.toThrow('invalid BY action');
  await expect(runner.execute(byStep('/admin-api/v1/auth/info'), byContext())).rejects.toThrow('invalid BY action');
  await expect(runner.execute(byStep('/c-api/v1/reports', { method: 'POST', safety: 'mutating' }), byContext())).rejects.toThrow('mutating API step requires allowMutations');
  expect(fetchImpl).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm test -- tests/by-api-runner.test.js`

Expected: FAIL because `server/runners/by-api-runner.js` does not exist.

- [ ] **Step 3: Implement the minimal runner**

Create `server/runners/by-api-runner.js` with the following boundaries:

```js
const BY_ACTION = /^\/c-api\/v1\/[A-Za-z0-9_/-]+$/;
const JSON_PATH = /^\$(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/;
const SECRET_KEY = /(?:password|token|authorization|secret|credential|contact)/i;
const BROWSER_USER_AGENT = 'Mozilla/5.0 (compatible; NovaTest/1.0; +https://example.invalid)';

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, SECRET_KEY.test(key) ? '********' : redact(item)]));
  return value;
}

function atPath(value, path) {
  if (!JSON_PATH.test(path)) throw new Error(`invalid JSON path: ${path}`);
  return path.slice(1).match(/\.[A-Za-z_$][\w$]*|\[\d+\]/g)?.reduce((current, part) => current == null
    ? undefined : part[0] === '.' ? current[part.slice(1)] : current[Number(part.slice(1, -1))], value) ?? (path === '$' ? value : undefined);
}

function appendQuery(params, payload) {
  Object.entries(payload).forEach(([key, value]) => (Array.isArray(value) ? value : [value])
    .filter((item) => item !== undefined && item !== null).forEach((item) => params.append(key, String(item))));
}

function byUrl(baseUrl, action, payload, method) {
  if (!BY_ACTION.test(action)) throw new Error(`invalid BY action: ${action}`);
  const base = new URL(baseUrl);
  const url = new URL(action, base);
  if (url.origin !== base.origin) throw new Error(`invalid BY action: ${action}`);
  if (method === 'GET') appendQuery(url.searchParams, payload);
  return url.toString();
}

function apiFailure(message, api) {
  const error = new Error(message);
  error.api = api;
  return error;
}

export class ByPreconditionError extends Error {
  constructor(message, api) {
    super(message);
    this.code = 'PRECONDITION_UNAVAILABLE';
    this.api = api;
  }
}

export class ByApiRunner {
  constructor({ fetchImpl = fetch } = {}) { this.fetchImpl = fetchImpl; }
  createSession() { return {}; }
  async execute(step, context) {
    const { request } = step;
    if (request.safety === 'mutating' && !context.allowMutations) throw new Error('mutating API step requires allowMutations');
    const payload = interpolate(request.payload || {}, context.variables || {});
    const startedAt = performance.now();
    const response = await this.fetchImpl(byUrl(context.testCase.baseUrl, request.action, payload, request.method), {
      method: request.method,
      headers: { accept: 'application/json', 'user-agent': BROWSER_USER_AGENT, ...(request.method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(request.method === 'POST' ? { body: JSON.stringify(payload) } : {})
    });
    const body = await response.json().catch(() => ({ code: undefined, msg: 'invalid JSON response', data: null }));
    const api = { action: request.action, method: request.method, httpStatus: response.status, businessStatus: body.code, durationMs: Math.round(performance.now() - startedAt), request: redact(payload), response: redact(body) };
    if (!(Array.isArray(request.expectedStatus) ? request.expectedStatus : [request.expectedStatus]).includes(response.status)) throw apiFailure(`API assertion failed: ${request.action}`, api);
    if (!(Array.isArray(request.expectedCode) ? request.expectedCode : [request.expectedCode]).includes(body.code)) throw apiFailure(`BY business assertion failed: ${request.action}`, api);
    (request.expectedJson || []).forEach((expectation) => {
      const actual = atPath(body, expectation.path);
      if ((expectation.exists !== undefined && (actual !== undefined) !== expectation.exists) || (Object.hasOwn(expectation, 'equals') && actual !== expectation.equals)) throw apiFailure(`JSON assertion failed: ${expectation.path}`, api);
    });
    const variables = Object.fromEntries(Object.entries(request.extract || {}).map(([name, path]) => {
      const value = atPath(body, path);
      if (value === undefined) throw new ByPreconditionError(`前置数据不足：无法提取 ${name}`, api);
      return [name, value];
    }));
    return { variables, api };
  }
}
```

For list-to-detail chains, use `extract` with `$.data.list[0].pubId` or `$.data.list[0].id`. `ByPreconditionError` gives the existing run service a stable `skipped` outcome when the public list is empty, rather than reporting an environment-data absence as an interface failure.

- [ ] **Step 4: Run the focused runner tests and confirm they pass**

Run: `npm test -- tests/by-api-runner.test.js`

Expected: exit code 0 with all BY runner tests passing.

- [ ] **Step 5: Commit the BY runner**

```bash
git add server/runners/by-api-runner.js tests/by-api-runner.test.js
git commit -m "feat: execute BY public API cases"
```

### Task 3: Route BY requests through the runtime

**Files:**
- Modify: `server/runners/composite-api-runner.js`
- Modify: `server/services/runtime-services.js`
- Modify: `tests/composite-api-runner.test.js`
- Modify: `tests/runtime-services.test.js`

**Interfaces:**
- `CompositeApiRunner` constructor accepts `{ cms, editorial, flywheel, daygf, by }`.
- `createRuntimeServices()` always constructs an unauthenticated `ByApiRunner`.
- Returns `byRunnerStatus: { ready, message }` and `byBaseUrl` is not required because every case owns its base URL.

- [ ] **Step 1: Write failing routing and service tests**

Add a composite routing test:

```js
it('routes BY requests to an isolated BY session', async () => {
  const by = { createSession: vi.fn(() => ({ protocol: 'by' })), execute: vi.fn(async (_step, context) => ({ variables: { sessionProtocol: context.apiSession.protocol } })) };
  const runner = new CompositeApiRunner({ cms: { execute: vi.fn() }, by });
  const result = await runner.execute({ request: { protocol: 'by' } }, { apiSession: runner.createSession() });
  expect(by.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiSession: { protocol: 'by' } }));
  expect(result.variables).toEqual({ sessionProtocol: 'by' });
});
```

Add a runtime service test that injects `ByRunner`, asserts it is constructed without credentials, and asserts `services.byRunnerStatus.ready` is true.

- [ ] **Step 2: Run the focused routing tests and confirm they fail**

Run: `npm test -- tests/composite-api-runner.test.js tests/runtime-services.test.js`

Expected: FAIL because `by` is not supplied to the composite runner or runtime service.

- [ ] **Step 3: Implement BY runner registration**

Update `CompositeApiRunner` to store `by` in `this.runners`. Update `createRuntimeServices` to import `ByApiRunner`, construct `new ByRunner()`, include it in the `CompositeApiRunner` constructor, and expose:

```js
const byRunnerStatus = { ready: true, message: 'BY public API runner is ready' };
```

Include an unavailable BY status in the early return only if construction can throw; no BY credentials are read from environment variables or SQLite.

- [ ] **Step 4: Run the focused routing tests and confirm they pass**

Run: `npm test -- tests/composite-api-runner.test.js tests/runtime-services.test.js`

Expected: exit code 0 with all focused tests passing.

- [ ] **Step 5: Commit runner registration**

```bash
git add server/runners/composite-api-runner.js server/services/runtime-services.js tests/composite-api-runner.test.js tests/runtime-services.test.js
git commit -m "feat: register BY API runner"
```

### Task 4: Seed stable BY project assets

**Files:**
- Create: `server/seed/by-cases.js`
- Create: `tests/by-cases.test.js`
- Modify: `server/index.js`

**Interfaces:**
- `byCases({ projectId, baseUrl })` returns deterministic BY API cases.
- `seedByCases(store, { projectId, baseUrl })` idempotently saves them and returns their count.
- Server startup ensures a project named `BY项目` and seeds its cases with base URL `https://by.chenmoyuan.tech`.

- [ ] **Step 1: Write failing seed tests**

Create `tests/by-cases.test.js`:

```js
it('creates BY public cases under the supplied project with stable identifiers', () => {
  const cases = byCases({ projectId: 'by-project', baseUrl: 'https://by.example.test' });
  expect(cases.length).toBeGreaterThanOrEqual(20);
  expect(cases.every((testCase) => testCase.projectId === 'by-project' && testCase.target === 'api')).toBe(true);
  expect(cases.every((testCase) => testCase.steps.every((step) => step.request.protocol === 'by'))).toBe(true);
  expect(new Set(cases.map((testCase) => testCase.id)).size).toBe(cases.length);
});

it('keeps successful reports and write operations opt-in', () => {
  const cases = byCases({ projectId: 'by-project', baseUrl: 'https://by.example.test' });
  const report = cases.find((testCase) => testCase.id === 'by-report-01');
  expect(report.steps.at(-1).request.safety).toBe('mutating');
  expect(cases.some((testCase) => testCase.id === 'by-member-01')).toBe(true);
  expect(cases.some((testCase) => testCase.id === 'by-content-01')).toBe(true);
});

it('writes BY cases idempotently', () => {
  const store = createMemoryStore();
  expect(seedByCases(store, { projectId: 'by-project', baseUrl: 'https://by.example.test' })).toBeGreaterThanOrEqual(20);
  expect(seedByCases(store, { projectId: 'by-project', baseUrl: 'https://changed.example.test' })).toBe(store.listCases('', 'by-project').length);
});
```

- [ ] **Step 2: Run the seed test and confirm it fails**

Run: `npm test -- tests/by-cases.test.js`

Expected: FAIL because `server/seed/by-cases.js` does not exist.

- [ ] **Step 3: Implement deterministic case definitions and startup seeding**

Create `server/seed/by-cases.js` using the established `daygf-cases.js` factory structure. Include these stable groups:

```text
by-member-01..08: member list, page boundary, combined filters, list-to-detail, invalid member, invalid image token
by-content-01..07: article list, category, list-to-detail, invalid article, notices, paging
by-config-01..07: contact, regions, friend links, site-info, landing-page, home-road, app visibility contract
by-report-01..04: missing required fields, overlength reason, invalid public ID, explicit mutation successful report
```

For list-to-detail cases, make two steps in the same case: the first selects and extracts `pubId` or article `id`, and the second interpolates `{{memberPubId}}` or `{{articleId}}`. Use `expectedCode: 0` for successful reads, `[40000, 40400]` only where the document permits either malformed-input result, and explicit `40400` for documented missing resources. Mark only the successful report request `mutating`.

In `server/index.js` add:

```js
import { seedByCases } from './seed/by-cases.js';

const byProject = store.listProjects().find((project) => project.name === 'BY项目') || store.saveProject({ name: 'BY项目' });
seedByCases(store, { projectId: byProject.id, baseUrl: 'https://by.chenmoyuan.tech' });
```

Place this after runtime service creation and before `createApp(...).listen(...)`; seeding does not make network calls.

- [ ] **Step 4: Run the seed test and confirm it passes**

Run: `npm test -- tests/by-cases.test.js`

Expected: exit code 0 with at least 20 deterministic BY assets and idempotent insertion.

- [ ] **Step 5: Commit the project assets**

```bash
git add server/seed/by-cases.js server/index.js tests/by-cases.test.js
git commit -m "feat: seed BY public API test cases"
```

### Task 5: Verify contract, reports, and the real read-only smoke suite

**Files:**
- Modify: `tests/app.test.js`
- Modify: `server/services/cms-crypto.js`
- Modify: `docs/superpowers/specs/2026-08-18-by-public-api-test-assets-design.md`

**Interfaces:**
- The API evidence report renders BY `businessStatus` and redacted public data through the existing report renderer.
- The real BY test run uses only case IDs whose steps are all `readonly`.

- [ ] **Step 1: Write a failing report evidence test**

Add to `tests/app.test.js`:

```js
it('renders BY business-code evidence with redacted contact data', () => {
  const report = renderReport({ id: 'by-run', status: 'failed', startedAt: null, variables: {}, steps: [{
    id: 'report', status: 'failed', attempts: 1, error: 'BY business assertion failed', api: {
      action: '/c-api/v1/reports', method: 'POST', httpStatus: 200, businessStatus: 40000, durationMs: 15,
      request: { contact: 'private' }, response: { code: 40000, data: { contact: 'private' } }
    }
  }] }, 'BY 举报校验');
  expect(report).toContain('业务状态 40000');
  expect(report).toContain('********');
  expect(report).not.toContain('private');
});
```

- [ ] **Step 2: Run the report test and confirm it fails if `contact` is not redacted**

Run: `npm test -- tests/app.test.js`

Expected: FAIL until the common report redaction recognizes `contact`.

- [ ] **Step 3: Apply the minimal common redaction extension**

Update `BUSINESS_SECRET_KEY` in `server/services/cms-crypto.js` from:

```js
const BUSINESS_SECRET_KEY = /authorization|token|password|secret|sign|key|iv|encrypt|sha/i;
```

to:

```js
const BUSINESS_SECRET_KEY = /authorization|token|password|secret|sign|key|iv|encrypt|sha|contact/i;
```

This is the renderer's final protection for manually supplied API evidence; the BY runner already redacts this field before persistence.

- [ ] **Step 4: Run all automated checks**

Run: `npm test`

Expected: exit code 0 with no failing test files.

- [ ] **Step 5: Start the platform and execute real BY P0 read-only assets**

Run: `npm start`

After the health endpoint responds, use the platform API to list cases for `BY项目`, select only the P0 member/content/config cases whose every step is `readonly`, create a BY-only batch, and poll it to a terminal state. Save the resulting batch report URL and record the actual pass/fail/skip totals in the design document's verification section. Do not execute `by-report-01` or any other `mutating` case.

- [ ] **Step 6: Commit verification documentation**

```bash
git add server/services/cms-crypto.js tests/app.test.js docs/superpowers/specs/2026-08-18-by-public-api-test-assets-design.md
git commit -m "test: verify BY public API assets"
```
