# 方舟社区发帖查询接口资产 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将缺失的方舟社区发帖只读接口场景幂等写入指定项目，并验证批量执行、会话复用、脱敏证据和报告。

**Architecture:** 新增方舟社区资产定义模块，按稳定 ID 同步四条用例到名称为“方舟社区发帖”的既有项目。正常查询沿用 `CmsApiRunner` 的惰性认证和批次共享会话；无效令牌步骤显式跳过认证，不登录且不覆盖其他用例会话。

**Tech Stack:** Node.js 22、Express、Vitest、SQLite、Node `fetch`、现有 AES-CBC CMS API 执行器。

## Global Constraints

- 仅实现和执行 `readonly` 用例；不得执行发布、审核、回复、删除等远程写操作。
- 通过项目名称“方舟社区发帖”查找项目，不得硬编码项目 ID。
- 请求、运行变量、SQLite 运行记录和报告不得保存账号、密码、Google 验证码、令牌、AES 密钥、IV、签名、密文或原始加密表单。
- CMS 配置仅由运行时环境变量提供；验证输出只能列出缺失变量名称，不能输出变量值。
- 所有 API 步骤使用 `POST`；查询预期业务状态 `1`，无效令牌拦截预期业务状态 `0`。

---

### Task 1: 支持隔离的无认证 API 步骤

**Files:**
- Modify: `server/domain/case.js:3-21`
- Modify: `server/runners/cms-api-runner.js:89-119`
- Modify: `tests/case.test.js`
- Modify: `tests/cms-api-runner.test.js`

**Interfaces:**
- Consumes: API 步骤的 `request` 对象。
- Produces: `request.auth` 仅允许 `'session'`（默认）或 `'none'`；`auth: 'none'` 不调用 `authenticate()` 且不注入共享会话令牌。

- [x] **Step 1: 写入失败测试**

在 `tests/case.test.js` 增加：

```js
it('accepts an API request that explicitly skips session authentication', () => {
  expect(validateWebCase({
    id: 'invalid-token', projectId: 'project-1', name: '无效登录态拦截', target: 'api',
    baseUrl: 'https://example.test/api.php', viewport: 'desktop',
    steps: [{ id: 'probe', kind: 'apiRequest', instruction: '使用无效令牌查询帖子', request: {
      action: 'list_post', method: 'POST', payload: { token: 'invalid-token' },
      expectedStatus: 0, safety: 'readonly', auth: 'none'
    } }]
  })).toBeDefined();
});

it('rejects unsupported API authentication modes', () => {
  expect(() => validateWebCase({
    id: 'bad-auth', projectId: 'project-1', name: '错误认证方式', target: 'api',
    baseUrl: 'https://example.test/api.php', viewport: 'desktop',
    steps: [{ id: 'probe', kind: 'apiRequest', instruction: '查询', request: {
      action: 'list_post', method: 'POST', payload: {}, expectedStatus: 1,
      safety: 'readonly', auth: 'password'
    } }]
  })).toThrow('invalid API request');
});
```

在 `tests/cms-api-runner.test.js` 增加：

```js
it('sends an explicit invalid token without logging in or changing the shared session', async () => {
  const actions = [];
  let submittedPayload;
  const runner = new CmsApiRunner({
    config: { ...cryptoConfig, username: 'synthetic-user', password: 'synthetic-password', googleSecret, oauthId: 'qa', oauthType: 'web', version: '1.0.0' },
    fetchImpl: async (url, options) => {
      actions.push(new URL(url).pathname.split('/').at(-1));
      submittedPayload = JSON.parse(decryptPayload(new URLSearchParams(options.body).get('data'), cryptoConfig));
      return { ok: true, status: 200, json: async () => encryptedResponse({ status: 0, msg: 'token invalid' }) };
    }
  });
  const context = { testCase: { baseUrl: 'https://example.test/api.php' }, variables: {}, apiSession: { token: 'existing-session-token' } };
  const result = await runner.execute({ id: 'invalid-token', request: {
    action: 'list_post', method: 'POST', payload: { token: 'invalid-token' },
    expectedStatus: 0, safety: 'readonly', auth: 'none'
  } }, context);
  expect(actions).toEqual(['list_post']);
  expect(submittedPayload.token).toBe('invalid-token');
  expect(context.apiSession).toEqual({ token: 'existing-session-token' });
  expect(result.api.businessStatus).toBe(0);
});
```

- [x] **Step 2: 确认测试先失败**

Run: `npm test -- tests/case.test.js tests/cms-api-runner.test.js`

Expected: 新增认证模式校验或执行行为尚未实现，至少一个新增断言失败。

- [x] **Step 3: 最小实现**

在 `server/domain/case.js` 的 API 校验中使用：

```js
const validAuth = request.auth === undefined || request.auth === 'session' || request.auth === 'none';
if (step.kind !== 'apiRequest' || !request?.action?.trim() || request.method !== 'POST'
  || !['readonly', 'mutating'].includes(request.safety) || !validAuth) {
  throw new Error('invalid API request');
}
```

在 `CmsApiRunner.execute()` 中保留 `loginByPassword` 分支；其他 action 使用：

```js
const session = context.apiSession ||= this.createSession();
const skipSession = request.auth === 'none';
const payload = this.clientPayload(interpolate(request.payload || {}, context.variables));
if (!skipSession) {
  await this.authenticate(context.testCase.baseUrl, session);
  payload.token = session.token;
}
const result = await this.request(request.action, payload, context.testCase.baseUrl, request.expectedStatus);
```

不得将 `context.apiSession` 写入 `variables`、API 证据或日志。

- [x] **Step 4: 确认测试通过**

Run: `npm test -- tests/case.test.js tests/cms-api-runner.test.js`

Expected: PASS；无认证测试只调用 `list_post` 一次。

- [x] **Step 5: 提交**

Run: `git add server/domain/case.js server/runners/cms-api-runner.js tests/case.test.js tests/cms-api-runner.test.js && git commit -m "feat: support isolated API auth probes"`

### Task 2: 定义并同步方舟社区查询资产

**Files:**
- Create: `server/seed/ark-community-cases.js`
- Modify: `server/index.js:1-52`
- Create: `tests/ark-community-cases.test.js`

**Interfaces:**
- Consumes: `store.listProjects()`、`store.saveCase(testCase)` 和运行时 `CMS_BASE_URL`。
- Produces: `arkCommunityCases({ projectId, baseUrl })` 返回四条完整 API 用例；`seedArkCommunityCases(store, { baseUrl })` 返回同步数量，项目不存在时返回 `0`。

- [x] **Step 1: 写入失败测试**

创建 `tests/ark-community-cases.test.js`：

```js
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { arkCommunityCases, seedArkCommunityCases } from '../server/seed/ark-community-cases.js';

describe('Ark community API cases', () => {
  it('defines readonly query and permission-probe actions', () => {
    const cases = arkCommunityCases({ projectId: 'ark-project', baseUrl: 'https://example.test/api.php' });
    expect(cases).toHaveLength(4);
    expect(cases.every((testCase) => testCase.projectId === 'ark-project' && testCase.target === 'api')).toBe(true);
    expect(cases.flatMap((testCase) => testCase.steps).every((step) => step.request.method === 'POST' && step.request.safety === 'readonly')).toBe(true);
    expect(cases.find((testCase) => testCase.name === '帖子状态筛选查询').steps.map((step) => step.request.payload.status)).toEqual([10, 0, 1, 2, 3]);
    expect(cases.find((testCase) => testCase.name === '无效登录态拦截').steps[0].request).toMatchObject({ action: 'list_post', expectedStatus: 0, auth: 'none', payload: { token: 'invalid-token' } });
  });

  it('writes cases into the named project without duplicates and refreshes the base URL', () => {
    const store = createMemoryStore();
    const project = store.saveProject({ name: '方舟社区发帖' });
    expect(seedArkCommunityCases(store, { baseUrl: 'https://first.test/api.php' })).toBe(4);
    expect(seedArkCommunityCases(store, { baseUrl: 'https://second.test/api.php' })).toBe(4);
    const cases = store.listCases('', project.id);
    expect(cases).toHaveLength(4);
    expect(cases.every((testCase) => testCase.baseUrl === 'https://second.test/api.php')).toBe(true);
  });
});
```

- [x] **Step 2: 确认新测试失败**

Run: `npm test -- tests/ark-community-cases.test.js`

Expected: FAIL，因 `server/seed/ark-community-cases.js` 尚不存在。

- [x] **Step 3: 创建用例定义与同步函数**

创建 `server/seed/ark-community-cases.js`。每条用例必须含 `projectId`、`target: 'api'`、`baseUrl`、`viewport: 'desktop'`。常规步骤使用：

```js
const apiStep = (id, instruction, action, payload) => ({
  id, kind: 'apiRequest', instruction,
  request: {
    action, method: 'POST', payload, expectedStatus: 1, safety: 'readonly',
    expectedJson: [{ path: '$.list', exists: true }, { path: '$.total', exists: true }]
  }
});
```

用例及步骤为：

```js
[
  ['ark-community-post-status-filters', '帖子状态筛选查询', [
    ['posts-all', '查询全部帖子', 'list_post', { status: 10, page: 1, limit: 5 }],
    ['posts-pending', '查询待审核帖子', 'list_post', { status: 0, page: 1, limit: 5 }],
    ['posts-approved', '查询已通过帖子', 'list_post', { status: 1, page: 1, limit: 5 }],
    ['posts-rejected', '查询未通过帖子', 'list_post', { status: 2, page: 1, limit: 5 }],
    ['posts-drafts', '查询草稿帖子', 'list_post', { status: 3, page: 1, limit: 5 }]
  ]],
  ['ark-community-comment-status-filters', '评论状态筛选查询', [
    ['comments-pending', '查询待审核评论', 'list_post_comments', { status: 0, page: 1, limit: 5 }],
    ['comments-approved', '查询已通过评论', 'list_post_comments', { status: 1, page: 1, limit: 5 }],
    ['comments-rejected', '查询未通过评论', 'list_post_comments', { status: 2, page: 1, limit: 5 }]
  ]],
  ['ark-community-member-status-filters', '用户资料审核状态筛选查询', [
    ['members-all', '查询全部用户资料修改记录', 'list_member_update_log', { status: 10, page: 1, limit: 5 }],
    ['members-pending', '查询待审核用户资料修改记录', 'list_member_update_log', { status: 0, page: 1, limit: 5 }],
    ['members-rejected', '查询未通过用户资料修改记录', 'list_member_update_log', { status: 1, page: 1, limit: 5 }],
    ['members-approved', '查询已通过用户资料修改记录', 'list_member_update_log', { status: 2, page: 1, limit: 5 }]
  ]]
]
```

追加稳定 ID 为 `ark-community-invalid-token-probe`、名称为“无效登录态拦截”的第四条用例。其唯一步骤请求为：

```js
{
  action: 'list_post', method: 'POST',
  payload: { status: 10, page: 1, limit: 1, token: 'invalid-token' },
  expectedStatus: 0, safety: 'readonly', auth: 'none'
}
```

同步函数必须为：

```js
export function seedArkCommunityCases(store, { baseUrl }) {
  const project = store.listProjects().find((item) => item.name === '方舟社区发帖');
  if (!project || !baseUrl) return 0;
  const cases = arkCommunityCases({ projectId: project.id, baseUrl });
  cases.forEach((testCase) => store.saveCase(testCase));
  return cases.length;
}
```

在 `server/index.js` 创建 SQLite store 后、启动 Express 前调用：

```js
if (cmsConfig.baseUrl) seedArkCommunityCases(store, { baseUrl: cmsConfig.baseUrl });
```

保留现有白包冒烟种子，不得移动其项目归属或改写现有用例。

- [x] **Step 4: 确认资产测试通过**

Run: `npm test -- tests/ark-community-cases.test.js tests/cms-whitebag-cases.test.js`

Expected: PASS。第二次同步后项目内仍只有四条新定义，且 base URL 更新。

- [x] **Step 5: 提交**

Run: `git add server/seed/ark-community-cases.js server/index.js tests/ark-community-cases.test.js && git commit -m "feat: seed ark community readonly API cases"`

### Task 3: 增加列表结构断言

**Files:**
- Modify: `server/runners/cms-api-runner.js:5-15`
- Modify: `tests/cms-api-runner.test.js`

**Interfaces:**
- Consumes: `request.expectedJson` 条目中的可选 `exists: boolean`。
- Produces: 路径缺失时抛出 `JSON assertion failed: <path>`，同时保持现有 `equals` 断言兼容。

- [x] **Step 1: 写入失败测试**

在 `tests/cms-api-runner.test.js` 增加：

```js
it('asserts that a decrypted list response contains required fields', async () => {
  const runner = new CmsApiRunner({
    config: { ...cryptoConfig, googleSecret, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'web', version: '1.0.0' },
    fetchImpl: async (url) => ({
      ok: true, status: 200,
      json: async () => encryptedResponse(new URL(url).pathname.endsWith('/loginByPassword') ? 'token-1' : { list: [], total: 0 })
    })
  });
  await expect(runner.execute({ id: 'posts', request: {
    action: 'list_post', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly',
    expectedJson: [{ path: '$.list', exists: true }, { path: '$.total', exists: true }]
  } }, { testCase: { baseUrl: 'https://example.test/api.php' }, variables: {} })).resolves.toBeDefined();
});

it('fails a list assertion when a required field is absent', async () => {
  const runner = new CmsApiRunner({
    config: { ...cryptoConfig, googleSecret, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'web', version: '1.0.0' },
    fetchImpl: async (url) => ({
      ok: true, status: 200,
      json: async () => encryptedResponse(new URL(url).pathname.endsWith('/loginByPassword') ? 'token-1' : { list: [] })
    })
  });
  await expect(runner.execute({ id: 'posts', request: {
    action: 'list_post', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly',
    expectedJson: [{ path: '$.total', exists: true }]
  } }, { testCase: { baseUrl: 'https://example.test/api.php' }, variables: {} })).rejects.toThrow('JSON assertion failed: $.total');
});
```

- [x] **Step 2: 确认测试先失败**

Run: `npm test -- tests/cms-api-runner.test.js`

Expected: 新增测试失败，因为 `assertJson()` 尚未处理 `exists`。

- [x] **Step 3: 实现存在性断言**

将 `server/runners/cms-api-runner.js` 的 `assertJson` 替换为：

```js
function assertJson(data, expectedJson = []) {
  expectedJson.forEach((expectation) => {
    const { path, exists, equals } = expectation;
    const value = jsonPathValue(data, path);
    if (exists !== undefined && Boolean(value !== undefined) !== exists) throw new Error(`JSON assertion failed: ${path}`);
    if (Object.hasOwn(expectation, 'equals') && value !== equals) throw new Error(`JSON assertion failed: ${path}`);
  });
}
```

既有的 `redactBusinessSecrets` 和 `redactTransportSecrets` 调用必须保留；不得把未脱敏响应写入 `api.response`。

- [x] **Step 4: 确认测试通过**

Run: `npm test -- tests/cms-api-runner.test.js tests/app.test.js`

Expected: PASS；成功与失败 API 步骤均保留已脱敏证据，报告标题仍为“请求摘要”和“响应内容”。

- [x] **Step 5: 提交**

Run: `git add server/runners/cms-api-runner.js tests/cms-api-runner.test.js && git commit -m "feat: assert API list response fields"`

### Task 4: 落库、批量执行与报告验证

**Files:**
- Modify: `docs/superpowers/plans/2026-07-24-ark-community-api-assets.md`（勾选完成项并记录验证结果）

**Interfaces:**
- Consumes: 已启动的平台、`data/novatest.db` 中的“方舟社区发帖”项目、运行时 CMS 环境变量和四条同步资产。
- Produces: 一个 API 批量运行记录及统一 HTML 报告。

- [x] **Step 1: 运行全量自动化测试**

Run: `npm test`

Expected: PASS；新增资产不改变既有白包、Web UI、报告测试结果。

- [x] **Step 2: 启动单一平台服务并检查 CMS 状态**

Run: `PORT=4173 npm start`

Expected: 服务监听 `http://127.0.0.1:4173`，`GET /api/health` 的 `cmsRunner.ready` 为 `true`。若为 `false`，记录缺失变量名称后停止真实执行，不得读取或显示变量值。

- [x] **Step 3: 确认项目资产**

在“方舟社区发帖”项目中确认以下 ID 各只有一条，且 `target` 均为 `api`：

```text
ark-community-post-status-filters
ark-community-comment-status-filters
ark-community-member-status-filters
ark-community-invalid-token-probe
```

- [x] **Step 4: 执行一次四用例 API 批任务**

通过 `ExecutionService.queueBatch()` 或平台执行中心选择上述四条资产。输出只允许包含批次 ID、用例状态、步骤状态和报告 URL。

Expected: 三个查询用例为 `passed`，无效登录态用例为 `passed`（业务状态为 `0`）。正常查询步骤合计只发起一次 `loginByPassword`；无效令牌步骤不触发登录且不影响其他步骤会话。

- [x] **Step 5: 检查统一报告并提交**

打开 `/api/batches/<batch-id>/report`，确认其中包含四个用例、动作、HTTP 状态、业务状态、耗时、“请求摘要”和“响应内容”，且不含令牌、密码、Google 验证码、AES 密钥、IV、签名或密文。

Run: `git add docs/superpowers/plans/2026-07-24-ark-community-api-assets.md && git commit -m "test: verify ark community API assets"`

## Verification Record

- Automated regression: `npm test` completed with 17 test files and 105 tests passing.
- Local service: `http://127.0.0.1:4173` is the single active platform service; its CMS API runner is ready.
- Asset synchronization: the existing “方舟社区发帖” project now contains the four stable asset IDs defined in this plan, with corrected `$.data.list` and `$.data.total` assertions.
- Real readonly batch: `7497c854-7458-4c09-abcf-3f380766e469` passed all four cases. The three authenticated query cases shared exactly one login; the isolated invalid-token probe passed with business status `0`.
- Report: `/api/batches/7497c854-7458-4c09-abcf-3f380766e469/report` contains all four cases, request summaries, response content, and no unmasked sensitive fields.
