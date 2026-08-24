# 方舟 AI 评论审核接口测试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在“方舟AI评论审核”项目中持久化并执行标准 JSON + Bearer JWT 的 AI 评论审核用例，同时保持现有 CMS 加密用例不变。

**Architecture:** API 请求以 `request.protocol` 选择执行器，缺省值为 `cms` 以兼容现有数据。新增 `EditorialApiRunner` 负责 JSON 登录、TOTP、JWT 复用、HTTP 断言和脱敏；`CompositeApiRunner` 将同一 API 批次的会话分隔给 CMS 与 Editorial 运行器。SQLite 运行配置中 `editorial` 为可选分组，配置后才启用新运行器。

**Tech Stack:** Node.js 22、Express、Vitest、SQLite (`node:sqlite`)、原生 `fetch`、既有 TOTP 工具。

## Global Constraints

- 所有账号、密码、TOTP 秘钥、JWT 和 Authorization 头只能存在于运行时内存或本地 SQLite 配置，禁止写入代码、测试夹具、用例定义、报告、日志和 Git。
- `delete`、`trigger`、配置 PUT、开关 PUT、并发锁及越权场景不创建用例也不执行。
- `approve` 与 `reject` 标记为 `mutating`，只有带 `allowMutations: true` 的任务才可发送。
- 缺少 `manual_review` 数据时必须返回 `skipped`，并保留脱敏的查询证据。
- 保持现有 CMS AES 请求、运行报告和 API 用例编辑行为兼容。

---

### Task 1: 扩展 API 用例协议与可选 Editorial 配置

**Files:**
- Modify: `server/domain/case.js`
- Modify: `server/services/runtime-config-service.js`
- Modify: `tests/case.test.js`
- Modify: `tests/runtime-config-service.test.js`
- Modify: `tests/helpers/runtime-config-fixture.js`

**Interfaces:**
- Consumes: `validateWebCase(input)` 与 `normalizeRuntimeConfig(input)`。
- Produces: `request.protocol` 为 `cms` 或 `editorial`；`runtimeConfig.editorial` 为可选的 `{ baseUrl, username, password, googleSecret }`。

- [ ] **Step 1: 写入协议与可选配置的失败测试**

```js
it('accepts an Editorial GET API request', () => {
  expect(() => validateWebCase({ ...apiCase, steps: [{
    id: 'summary', kind: 'apiRequest', instruction: '读取评论概览',
    request: { protocol: 'editorial', action: 'ai-comment/summary', method: 'GET', payload: {}, expectedStatus: 200, safety: 'readonly' }
  }] })).not.toThrow();
});

it('keeps legacy runtime configuration valid when editorial is absent', () => {
  expect(normalizeRuntimeConfig(completeRuntimeConfig)).not.toHaveProperty('editorial');
});
```

- [ ] **Step 2: 运行失败测试确认接口尚未支持**

Run: `npm test -- tests/case.test.js tests/runtime-config-service.test.js`

Expected: `GET` 或 `protocol: editorial` 被当前 API 校验拒绝。

- [ ] **Step 3: 实现最小校验与配置归一化**

```js
const apiProtocols = new Set(['cms', 'editorial']);
const apiMethods = new Set(['GET', 'POST']);

function normalizeEditorial(input) {
  if (input === undefined) return undefined;
  return normalizeGroup(input, ['baseUrl', 'username', 'password', 'googleSecret'], 'editorial', 'baseUrl');
}

// API 步骤：CMS 只允许 POST；Editorial 允许 GET/POST。
const protocol = request.protocol || 'cms';
if (!apiProtocols.has(protocol) || !apiMethods.has(request.method)
  || (protocol === 'cms' && request.method !== 'POST')) throw new Error('invalid API request');
```

`runtimeConfigFromEnvironment()` 仅映射 `EDITORIAL_BASE_URL`、`EDITORIAL_USERNAME`、`EDITORIAL_PASSWORD`、`EDITORIAL_GOOGLE_SECRET`，并且只有四项齐全时生成 `editorial` 分组。

- [ ] **Step 4: 运行聚焦测试确认通过**

Run: `npm test -- tests/case.test.js tests/runtime-config-service.test.js`

Expected: 两个文件全部通过；旧配置不要求 Editorial 凭据。

- [ ] **Step 5: 提交此任务**

```bash
git add server/domain/case.js server/services/runtime-config-service.js tests/case.test.js tests/runtime-config-service.test.js tests/helpers/runtime-config-fixture.js
git commit -m "feat: support editorial API protocol configuration"
```

### Task 2: 实现标准 JSON + Bearer Editorial 执行器

**Files:**
- Create: `server/runners/editorial-api-runner.js`
- Modify: `server/services/cms-crypto.js`
- Create: `tests/editorial-api-runner.test.js`

**Interfaces:**
- Consumes: `{ baseUrl, username, password, googleSecret }` 配置、`generateTotp(secret)`、API 步骤的 `action`、`method`、`payload`、`expectedStatus`、`expectedJson`、`extract`、`select`。
- Produces: `EditorialApiRunner#createSession()`、`#execute(step, context)`，返回 `{ variables, api }`；`api` 只含脱敏请求/响应。

- [ ] **Step 1: 写入 Editorial 登录、会话和脱敏失败测试**

```js
it('logs in once, adds a bearer token, and does not expose secrets in evidence', async () => {
  const calls = [];
  const runner = new EditorialApiRunner({ config, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/api/auth/login')
      ? jsonResponse(200, { access_token: 'private-jwt' })
      : jsonResponse(200, { today: '2026-08-03', rows: [] });
  }});
  const context = { testCase: { baseUrl: config.baseUrl }, variables: {} };
  const result = await runner.execute(editorialGet('ai-comment/summary'), context);
  expect(calls).toHaveLength(2);
  expect(calls[1].options.headers.authorization).toBe('Bearer private-jwt');
  expect(JSON.stringify(result.api)).not.toContain('private-jwt');
});
```

- [ ] **Step 2: 运行新测试确认失败**

Run: `npm test -- tests/editorial-api-runner.test.js`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现最小执行器**

```js
async authenticate(baseUrl, session) {
  if (session.token) return session;
  const response = await this.fetchImpl(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: this.config.username, password: this.config.password,
      totp_code: generateTotp(this.config.googleSecret) })
  });
  const body = await readJson(response);
  if (!response.ok || !body.access_token) throw apiError('Editorial authentication failed', evidence);
  session.token = body.access_token;
  return session;
}
```

实现 `GET` 的查询参数编码、`POST` 的 JSON Body、HTTP 状态断言、JSON path 断言、变量提取与列表选择。列表选择须支持：

```js
select: {
  listPath: '$.items', variable: 'commentId', idPath: '$.id',
  extract: { cmsCommentId: '$.cms_comment_id' }
}
```

所选条目的 `extract` 从同一条记录取值；每次选择将本地 ID 写入 `context.selectedApiIds`。将 `authorization` 与 `access_token` 加入通用脱敏键规则。

- [ ] **Step 4: 补齐失败路径测试并运行**

```js
it('skips when no manual review item can be selected', async () => {
  await expect(runner.execute(manualReviewSelect, context)).rejects.toMatchObject({ code: 'PRECONDITION_UNAVAILABLE' });
});

it('requires mutation authorization before review action', async () => {
  await expect(runner.execute(approveStep, context)).rejects.toThrow('mutating API step requires allowMutations');
});
```

Run: `npm test -- tests/editorial-api-runner.test.js tests/cms-api-runner.test.js`

Expected: 全部通过；CMS 测试不回归。

- [ ] **Step 5: 提交此任务**

```bash
git add server/runners/editorial-api-runner.js server/services/cms-crypto.js tests/editorial-api-runner.test.js
git commit -m "feat: add bearer editorial API runner"
```

### Task 3: 路由 API 协议并约束批量会话

**Files:**
- Create: `server/runners/composite-api-runner.js`
- Modify: `server/services/runtime-services.js`
- Modify: `server/app.js`
- Modify: `tests/runtime-services.test.js`
- Modify: `tests/batch-service.test.js`
- Modify: `tests/app.test.js`

**Interfaces:**
- Consumes: `CmsApiRunner`、`EditorialApiRunner`、`request.protocol`。
- Produces: `CompositeApiRunner` 作为唯一 `runner.api`，并暴露独立的 CMS 与 Editorial 就绪状态。

- [ ] **Step 1: 写入协议路由与混合批量拒绝的失败测试**

```js
it('routes an editorial request to the editorial runner session', async () => {
  const api = new CompositeApiRunner({ cms, editorial });
  await api.execute({ request: { protocol: 'editorial' } }, { apiSession: api.createSession() });
  expect(editorial.execute).toHaveBeenCalledOnce();
  expect(cms.execute).not.toHaveBeenCalled();
});

it('rejects an API batch with multiple request protocols', async () => {
  await request(app).post('/api/batches').send({ caseIds: [cmsCase.id, editorialCase.id] })
    .expect(409).expect({ error: '批量执行只能选择同一接口协议的用例' });
});
```

- [ ] **Step 2: 运行失败测试确认当前不支持协议路由**

Run: `npm test -- tests/runtime-services.test.js tests/batch-service.test.js tests/app.test.js`

Expected: FAIL，尚无 `CompositeApiRunner` 且批量接口未校验协议。

- [ ] **Step 3: 实现复合运行器与服务接线**

```js
createSession() { return { cms: this.cms.createSession(), editorial: this.editorial.createSession() }; }

async execute(step, context) {
  const protocol = step.request.protocol || 'cms';
  const runner = this.runners[protocol];
  if (!runner) throw new Error(`API runner is unavailable: ${protocol}`);
  return runner.execute(step, { ...context, apiSession: context.apiSession[protocol] });
}
```

`createRuntimeServices()` 独立创建 CMS 和 Editorial 运行器：没有 `editorial` 配置时保留 CMS 可用性，并以状态字段告知 Editorial 未配置。`POST /api/batches` 计算每个用例第一步的 `request.protocol || 'cms'`，不一致时返回 409。

- [ ] **Step 4: 运行聚焦测试确认通过**

Run: `npm test -- tests/runtime-services.test.js tests/batch-service.test.js tests/app.test.js`

Expected: 所有聚焦文件通过，且 Editorial 不影响 CMS 或 Web UI 执行状态。

- [ ] **Step 5: 提交此任务**

```bash
git add server/runners/composite-api-runner.js server/services/runtime-services.js server/app.js tests/runtime-services.test.js tests/batch-service.test.js tests/app.test.js
git commit -m "feat: route API cases by protocol"
```

### Task 4: 保留 Editorial 用例编辑信息并写入固定用例库

**Files:**
- Modify: `app.js`
- Modify: `index.html`
- Create: `server/seed/ark-ai-comment-review-cases.js`
- Modify: `server/index.js`
- Create: `tests/ark-ai-comment-review-cases.test.js`
- Modify: `tests/styles.test.js`

**Interfaces:**
- Consumes: API 编辑器步骤 `request.protocol` 与 `request.method`、`seedArkAiCommentReviewCases(store, { baseUrl })`。
- Produces: 协议/方法可编辑且不会丢失；目标项目具备四条固定 ID 用例。

- [ ] **Step 1: 写入编辑器和种子用例的失败测试**

```js
it('seeds only non-delete AI comment review cases into the editorial project', () => {
  const cases = arkAiCommentReviewCases({ projectId: 'editorial-project', baseUrl: 'https://example.test' });
  expect(cases.map((item) => item.name)).toEqual([
    'AI 评论概览查询', 'AI 评论审核列表查询', 'AI 评论人工通过闭环', 'AI 评论人工驳回闭环'
  ]);
  expect(JSON.stringify(cases)).not.toContain('delete');
});
```

- [ ] **Step 2: 运行失败测试确认用例尚未生成**

Run: `npm test -- tests/ark-ai-comment-review-cases.test.js tests/styles.test.js`

Expected: FAIL，种子模块和协议编辑控件尚不存在。

- [ ] **Step 3: 实现种子用例和编辑器字段保存**

在 API 步骤 UI 中加入“协议”选择（`CMS 加密` / `方舟审核`）和“请求方法”选择（`POST` / `GET`），并在 `renderApiStepNode()`、预览和提交序列化中保留：

```js
request: {
  protocol: value('protocol') || 'cms', method: value('method'), action: value('action'),
  payload: parseJson(value('payload'), '请求 Body', {}), expectedStatus: Number(value('expectedStatus')),
  safety: value('safety'), expectedJson: parseJson(value('expectedJson'), 'JSON 断言', []),
  extract: parseJson(value('extract'), '变量提取', {}), select: parseJson(value('select'), '列表选择', undefined)
}
```

种子用例均使用 `protocol: 'editorial'`。通过/驳回分别执行：`GET ai-comment-review/list?status=manual_review` 选择本地 ID 与 CMS 评论 ID，`POST ai-comment-review/action`，再以 `GET ai-comment-review/list?id_q={{cmsCommentId}}` 回查 `status`、`review_reason` 和 `reviewed_at`。用例不包含 `delete` 或 `trigger` 字符串。

- [ ] **Step 4: 运行聚焦测试确认通过**

Run: `npm test -- tests/ark-ai-comment-review-cases.test.js tests/styles.test.js tests/case.test.js`

Expected: 四条用例可重复落库，编辑器序列化保留协议和方法。

- [ ] **Step 5: 提交此任务**

```bash
git add app.js index.html server/seed/ark-ai-comment-review-cases.js server/index.js tests/ark-ai-comment-review-cases.test.js tests/styles.test.js
git commit -m "feat: seed AI comment review API cases"
```

### Task 5: 写入本地运行配置并完成受控集成验证

**Files:**
- Modify: `data/novatest.db`（本地运行数据，不纳入代码提交）
- Modify: `tests/sqlite-store.test.js`
- Modify: `tests/app.test.js`

**Interfaces:**
- Consumes: 已实现的 `store.saveRuntimeConfig()`、测试账号的本地输入值、`/api/cases/:id/runs` 与 `/api/batches`。
- Produces: SQLite 中可用的 Editorial 配置和包含脱敏证据的真实报告。

- [ ] **Step 1: 写入 SQLite 往返与报告脱敏的失败测试**

```js
it('persists optional editorial runtime configuration without exposing it in API evidence', () => {
  store.saveRuntimeConfig({ ...completeRuntimeConfig, editorial: editorialConfig });
  expect(store.getRuntimeConfig().editorial).toEqual(editorialConfig);
});
```

- [ ] **Step 2: 运行失败测试确认新配置未被持久化覆盖**

Run: `npm test -- tests/sqlite-store.test.js tests/app.test.js`

Expected: FAIL，直到 Task 1 的运行配置和 Task 2 的脱敏行为均已完成。

- [ ] **Step 3: 写入本地配置并启动服务**

使用一次性本地脚本读取现有 SQLite 配置，合并由操作者提供的 Editorial 值并调用 `saveRuntimeConfig()`；脚本不得打印或写入凭据。随后使用 `npm start` 在固定端口 `4173` 启动服务。

- [ ] **Step 4: 执行真实只读与受控审核验证**

1. 以平台管理员登录本地服务。
2. 执行“AI 评论概览查询”和“AI 评论审核列表查询”，验证登录、JWT 复用、HTTP 200、报告脱敏。
3. 在 `allowMutations: true` 下批量执行“人工通过闭环”和“人工驳回闭环”。若没有足够的 `manual_review` 记录，接受 `skipped`，检查前置条件证据；不得改为其他写操作。
4. 请求每个报告，确认不包含配置密码、动态码、JWT 或 `Authorization`。

- [ ] **Step 5: 运行完整回归并提交代码**

Run: `npm test`

Expected: 退出码 0，所有测试通过。

```bash
git add server/domain/case.js server/services/runtime-config-service.js server/runners/editorial-api-runner.js server/runners/composite-api-runner.js server/runners/cms-api-runner.js server/services/cms-crypto.js server/services/runtime-services.js server/seed/ark-ai-comment-review-cases.js server/index.js server/app.js app.js index.html tests
git commit -m "feat: add AI comment review API automation"
```

不要暂存 `data/novatest.db`、截图、运行报告或既有无关改动。
