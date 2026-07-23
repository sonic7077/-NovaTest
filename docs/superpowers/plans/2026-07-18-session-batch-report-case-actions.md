# 会话校验、批量报告与用例操作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复接口会话 token 处理，提供批量汇总报告和本地时间，并补全测试资产列表的批量与单条操作。

**Architecture:** `CmsApiRunner` 在解包后以业务体状态决定请求成败，登录仅接受已解包的字符串 token。报告服务新增可复用的本地时间、运行明细与批次汇总渲染函数，应用层新增批量报告路由。资产页基于既有 case 删除与运行 API 增加全选、批量删除及行操作。

**Tech Stack:** Node.js 22、Express、Vitest、Vanilla JavaScript、SQLite、Node 原生 `Intl.DateTimeFormat`。

## Global Constraints

- 生产 CMS 的 token、密码、密钥、密文和签名只允许存在于运行时内存，禁止写入日志、报告、测试固定值或 Git；测试仅可使用合成值。
- 批量 API 用例共用一个内存 session；单条 API 用例使用独立 session。
- 报告的存储时间保留 ISO UTC；显示时间固定为 `Asia/Shanghai` 的 `YYYY-MM-DD HH:mm:ss`。
- 批量删除只删除用例定义，运行记录和报告必须保持可访问。
- 继续拒绝跨项目或跨执行类型批量执行。

---

### Task 1: 修正无标识登录与业务状态判定

**Files:**
- Modify: `server/runners/cms-api-runner.js:20-109`
- Modify: `tests/cms-api-runner.test.js:12-203`

**Interfaces:**
- Consumes: CMS 外层协议 `status` / `errcode` 和解包后的业务对象。
- Produces: `CmsApiRunner.request()` 只在最终业务状态符合 `expectedStatus` 时返回；`authenticate()` 存入已解包的字符串 token。

- [ ] **Step 1: 写入失败测试**

在 `tests/cms-api-runner.test.js` 增加以下两个测试，使用合成会话值构造无 `crypt` 标识登录响应，且不输出实际运行环境的 token：

```js
it('decrypts an unmarked encrypted login token before reusing the session', async () => {
  const syntheticSessionValue = 'synthetic-session-value';
  const submittedTokens = [];
  const runner = new CmsApiRunner({
    config: { ...cryptoConfig, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'web', version: '1.0.0' },
    fetchImpl: async (url, options) => {
      const action = new URL(url).pathname.split('/').at(-1);
      const payload = JSON.parse(decryptPayload(new URLSearchParams(options.body).get('data'), cryptoConfig));
      if (action !== 'loginByPassword') submittedTokens.push(payload.token);
      return { ok: true, status: 200, json: async () => action === 'loginByPassword'
        ? { errcode: 0, data: encryptPayload(JSON.stringify(syntheticSessionValue), cryptoConfig) }
        : encryptedResponse({ status: 1, data: [] }) };
    }
  });
  await runner.execute(apiStep('list_post'), { testCase: { baseUrl: 'https://example.test' }, variables: {} });
  expect(submittedTokens).toEqual([syntheticSessionValue]);
});

it('fails when a decrypted business body overrides an outer success status', async () => {
  const runner = new CmsApiRunner({
    config: { ...cryptoConfig, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'web', version: '1.0.0' },
    fetchImpl: async (url) => ({
      ok: true, status: 200,
      json: async () => new URL(url).pathname.endsWith('/loginByPassword')
        ? encryptedResponse('synthetic-session-value')
        : encryptedResponse({ status: 0, msg: 'token invalid' })
    })
  });
  await expect(runner.execute(apiStep('list_post'), { testCase: { baseUrl: 'https://example.test' }, variables: {} })).rejects.toThrow('API assertion failed: list_post');
});
```

Define a small test-only `apiStep(action)` helper returning a readonly POST request so tests do not repeat step construction. Replace the existing `keeps unmarked login data for the session while decrypting the business response` fixture: its login response currently encrypts an object and only asserts a token-like string, which does not model the production login protocol. The replacement must encrypt `JSON.stringify(syntheticSessionValue)` and assert that the decrypted value is sent to the following readonly request.

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- tests/cms-api-runner.test.js`

Expected: FAIL because the runner stores the encrypted login string and accepts the outer success code.

- [ ] **Step 3: 最小实现**

在 `server/runners/cms-api-runner.js` 统一处理无标识字符串。删除 `autoDecrypt` 参数，让解包逻辑对登录和业务请求一致：

```js
function responseData(outer, config) {
  if (outer.crypt) return parseEncryptedResponse(outer.data, config);
  if (typeof outer.data !== 'string') return outer.data;
  try { return parseEncryptedResponse(outer.data, config); }
  catch { return outer.data; }
}

function businessStatus(outer, data) {
  if (data && typeof data === 'object') {
    if (typeof data.status === 'number') return data.status;
    if (data.errcode === 0) return 1;
    if (typeof data.errcode === 'number') return data.errcode;
  }
  return outer.status ?? (outer.errcode === 0 ? 1 : outer.errcode);
}
```

在 `request()` 中先调用 `responseData`，再调用 `businessStatus`，之后才与 `expectedStatus` 比较。保留 `authenticate()` 的非空字符串校验，不记录 token。

- [ ] **Step 4: 运行定向测试并确认通过**

Run: `npm test -- tests/cms-api-runner.test.js`

Expected: PASS；现有加密、未标识业务响应、共享 session 和新回归场景均通过。

- [ ] **Step 5: 提交**

```bash
git add server/runners/cms-api-runner.js tests/cms-api-runner.test.js
git commit -m "fix: validate decrypted CMS session state"
```

### Task 2: 新增本地时间和批量汇总报告

**Files:**
- Modify: `server/services/report-service.js:1-27`
- Modify: `server/app.js:7-179`
- Modify: `tests/app.test.js:1-282`

**Interfaces:**
- Produces: `formatLocalTime(value)`, `renderBatchReport(batch, runs)` 和 `GET /api/batches/:id/report`。
- Consumes: 已持久化 batch 的 `runIds` 顺序和每个 run 的步骤证据。

- [ ] **Step 1: 写入失败测试**

在 `tests/app.test.js` 增加报告服务测试：

```js
it('renders a batch report with Shanghai local time and ordered run details', () => {
  const report = renderBatchReport(
    { id: 'batch-1', name: '查询回归', status: 'failed', startedAt: '2026-07-18T05:40:00.000Z', finishedAt: '2026-07-18T05:41:02.000Z', caseIds: ['case-1', 'case-2'] },
    [
      { id: 'run-1', caseId: 'case-1', caseName: '帖子列表查询', status: 'passed', startedAt: '2026-07-18T05:40:00.000Z', finishedAt: '2026-07-18T05:40:10.000Z', variables: {}, steps: [{ id: 'list_post', instruction: '帖子列表查询', status: 'passed', attempts: 1, api: { action: 'list_post', httpStatus: 200, businessStatus: 1, durationMs: 100, request: { token: 'synthetic-session-value' }, response: { status: 1 } } }] },
      { id: 'run-2', caseId: 'case-2', caseName: '评论列表查询', status: 'failed', startedAt: '2026-07-18T05:40:10.000Z', finishedAt: '2026-07-18T05:41:02.000Z', variables: {}, steps: [{ id: 'list_post_comments', instruction: '评论列表查询', status: 'failed', attempts: 2, error: 'API assertion failed', api: { action: 'list_post_comments', httpStatus: 200, businessStatus: 0, durationMs: 80, request: { token: 'synthetic-session-value' }, response: { status: 0 } } }] }
    ]
  );
  expect(report).toContain('查询回归');
  expect(report).toContain('1 通过 · 1 失败');
  expect(report).toContain('2026-07-18 13:40:00');
  expect(report).toContain('list_post');
  expect(report).toContain('********');
});
```

在已有批量 API 测试之后增加路由测试：创建两个用例和批次，断言 `GET /api/batches/:id/report` 为 HTML、含批次名称和两个用例名称；未知批次返回 404。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- tests/app.test.js -t "batch report"`

Expected: FAIL because `renderBatchReport` 和批量报告路由不存在。

- [ ] **Step 3: 最小实现**

在 `report-service.js` 提取已有单条步骤表格为 `runRows(run)`，添加：

```js
export function formatLocalTime(value) {
  if (!value) return '-';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value: item }) => [type, item]));
  return `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}:${fields.second}`;
}
```

让 `renderReport()` 显示 `formatLocalTime(run.startedAt)` 和 `formatLocalTime(run.finishedAt)`。实现 `renderBatchReport(batch, runs)`：统计 `passed`、`failed`，按 `runs` 入参顺序渲染每个 run 的名称、状态、本地时间和 `runRows(run)`；复用 API 证据脱敏函数。

在 `server/app.js` 导入 `renderBatchReport`，添加：

```js
app.get('/api/batches/:id/report', (req, res) => {
  const batch = store.getBatch(req.params.id);
  if (!batch) return res.status(404).send('batch report not found');
  const runs = batch.runIds.map((id) => store.getRun(id)).filter(Boolean);
  return res.type('html').send(renderBatchReport(batch, runs));
});
```

- [ ] **Step 4: 运行定向测试并确认通过**

Run: `npm test -- tests/app.test.js`

Expected: PASS；单条报告继续可用，批量报告保留顺序、时间和脱敏证据。

- [ ] **Step 5: 提交**

```bash
git add server/services/report-service.js server/app.js tests/app.test.js
git commit -m "feat: add batch summary reports"
```

### Task 3: 补全用例列表全选、删除与单条执行操作

**Files:**
- Modify: `index.html:78-83`
- Modify: `app.js:353-496, 541-610`
- Modify: `style.css:188-225`
- Modify: `tests/styles.test.js:8-66`

**Interfaces:**
- Consumes: `selectedCaseIds`、`POST /api/cases/:id/runs`、`DELETE /api/cases/:id` 和已有 `renderRun()`。
- Produces: `toggleVisibleCases()`, `deleteSelectedCases()`, `runSavedCase(testCase)`、`deleteSavedCase(testCase)` 和批量报告链接。

- [ ] **Step 1: 写入失败测试**

在 `tests/styles.test.js` 增加静态契约：

```js
expect(html).toContain('id="selectAllCases"');
expect(html).toContain('id="deleteSelectedCases"');
expect(script).toContain('function toggleVisibleCases()');
expect(script).toContain('async function deleteSelectedCases()');
expect(script).toContain('async function runSavedCase(testCase)');
expect(script).toContain('async function deleteSavedCase(testCase)');
expect(script).toContain('`/api/batches/${batch.id}/report`');
expect(stylesheet).toContain('.case-row-actions');
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL because the new controls and functions do not exist.

- [ ] **Step 3: 最小实现**

在列表表头增加唯一的选择框：

```html
<input id="selectAllCases" type="checkbox" aria-label="全选当前用例" />
```

在选择栏使用图标按钮增加 `#deleteSelectedCases`，默认 disabled。为每行的 `.case-row-actions` 追加唯一 title 的执行、编辑和删除按钮（`play`、`pencil`、`trash-2`）。

实现：

```js
function toggleVisibleCases() {
  const visibleIds = savedCases.map(({ id }) => id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedCaseIds.has(id));
  visibleIds.forEach((id) => allSelected ? selectedCaseIds.delete(id) : selectedCaseIds.add(id));
  loadSavedCases().catch((error) => showToast(error.message, true));
}

async function runSavedCase(testCase) {
  const response = await fetch(`/api/cases/${encodeURIComponent(testCase.id)}/runs`, { method: 'POST' });
  if (!response.ok) throw new Error((await response.json()).error || '执行测试用例失败');
  const run = await response.json();
  location.hash = '#/dashboard';
  renderRun(run);
  await loadBatchHistory(testCase.projectId);
}
```

`deleteSelectedCases()` 和 `deleteSavedCase()` 均在 `window.confirm` 通过后删除定义、从 `selectedCaseIds` 移除 ID，并刷新列表与历史。`updateBatchSelection()` 同步 `#selectAllCases.checked`、`indeterminate`、批量删除按钮状态。`renderBatchHistory()` 将多个单条链接替换成唯一的 `/api/batches/${batch.id}/report` 链接。

为 `.case-row-actions` 设置固定 `display:flex`、间距与 30px 工具按钮尺寸，防止行操作挤压表格列。

- [ ] **Step 4: 运行定向测试并确认通过**

Run: `npm test -- tests/styles.test.js`

Expected: PASS；静态契约覆盖全选、批量删除、单条执行/删除和汇总报告链接。

- [ ] **Step 5: 提交**

```bash
git add index.html app.js style.css tests/styles.test.js
git commit -m "feat: add case list batch actions"
```

### Task 4: 服务重启、真实只读验收与完整回归

**Files:**
- Modify: 仅运行时 SQLite 数据；不提交 `data/novatest.db`、`evidence/`、`.env` 或 `.DS_Store`。

**Interfaces:**
- Consumes: 更新后的本地服务、方舟社区发帖项目的已有只读用例。
- Produces: 可审计的单条与批量报告验证结果。

- [ ] **Step 1: 重启本地服务**

停止旧的 `127.0.0.1:4173` 进程，再运行 `npm start`，确认 `/api/health` 可访问。不要输出环境变量值、账号信息或密钥。

- [ ] **Step 2: 验证登录与单条查询**

运行安全 Node 脚本：只调用一条 `list_post` 只读用例，输出运行状态、步骤动作、报告是否含“响应内容”、是否存在旧标签；禁止输出 token、请求、响应正文、密文或签名。预期该步骤不再是错误的通过状态：真实业务失败应失败，正确登录应通过。

- [ ] **Step 3: 验证批量汇总报告**

选择同一项目的两条 API 查询用例并创建批次，读取 `/api/batches/:id/report`。只输出批次状态、报告是否含两条用例名称、是否含 `响应内容` 与 `********`；禁止输出业务正文。

- [ ] **Step 4: 浏览器验收**

使用浏览器在方舟社区发帖资产页检查：表头全选与取消全选、批量删除按钮启用状态、每行的执行/编辑/删除按钮，以及最近批次的唯一汇总报告链接。删除操作在确认框出现时取消，避免删除用户已有资产。

- [ ] **Step 5: 完整验证与提交检查**

Run: `npm test`

Expected: 所有测试通过。

Run: `git status --short`

Expected: 仅保留既有运行时未跟踪文件，不含本任务源文件的未提交修改。
