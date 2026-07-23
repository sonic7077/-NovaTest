# CMS Config 用例与解密报告 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在方舟社区发帖项目中执行 CMS `config` 只读接口，并在报告中安全展示解密后的业务响应。

**Architecture:** 现有 `CmsApiRunner` 继续负责加密传输、懒登录和响应解密。脱敏服务统一将敏感值替换为星号掩码；报告服务在渲染 API 证据前再次调用该服务，确保旧运行数据也不会泄露敏感值。

**Tech Stack:** Node.js 22、Express、Vitest、SQLite、Node 原生 fetch、AES-128-CBC。

## Global Constraints

- CMS 基础地址、密钥、IV、appKey、账号、密码和 token 仅从运行时环境读取，绝不写入源码、文档、用例、报告或提交。
- `config` 是只读接口；本计划不引入或执行任何写操作。
- 同次执行中仅允许执行器通过内存会话进行一次 `loginByPassword` 认证。
- 报告中的密码、token、密钥、`data` 与 `sign` 的值必须显示为 `********`。

---

### Task 1: 统一 CMS 证据的星号脱敏

**Files:**
- Modify: `server/services/cms-crypto.js:26-30`
- Modify: `tests/cms-crypto.test.js:13-20`

**Interfaces:**
- Consumes: `redactSecrets(value)` 的对象和数组递归输入。
- Produces: `redactSecrets(value)`，返回相同的非敏感结构，且任何敏感字段值为 `********`。

- [ ] **Step 1: 写入失败测试**

在 `tests/cms-crypto.test.js` 的现有脱敏断言后增加：

```js
expect(redactSecrets({
  token: 'secret-token',
  password: 'secret-password',
  nested: { sign: 'signature', ok: true }
})).toEqual({
  token: '********',
  password: '********',
  nested: { sign: '********', ok: true }
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- tests/cms-crypto.test.js`

Expected: FAIL，因为当前实现返回 `[REDACTED]`。

- [ ] **Step 3: 最小实现**

在 `server/services/cms-crypto.js` 中定义并复用掩码常量：

```js
const SECRET_MASK = '********';

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /token|password|data|sign|key|iv/i.test(key) ? SECRET_MASK : redactSecrets(item)
  ]));
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test -- tests/cms-crypto.test.js tests/cms-api-runner.test.js`

Expected: PASS；加密传输、登录复用和 API 证据仍被脱敏。

- [ ] **Step 5: 提交**

```bash
git add server/services/cms-crypto.js tests/cms-crypto.test.js tests/cms-api-runner.test.js
git commit -m "fix: mask CMS API evidence values"
```

### Task 2: 报告标注并强制脱敏解密后响应

**Files:**
- Modify: `server/services/report-service.js:1-18`
- Modify: `tests/app.test.js:256-274`

**Interfaces:**
- Consumes: 运行步骤的 `step.api = { action, httpStatus, businessStatus, durationMs, request, response }`。
- Produces: API 报告证据，其中请求与响应由 `redactSecrets` 处理，响应折叠标题固定为“解密后响应”。

- [ ] **Step 1: 写入失败测试**

将 API 报告测试的响应替换为含敏感字段的数据，并加入以下断言：

```js
expect(report).toContain('解密后响应');
expect(report).toContain('********');
expect(report).not.toContain('secret-token');
expect(report).not.toContain('secret-password');
expect(report).not.toContain('响应摘要');
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- tests/app.test.js`

Expected: FAIL，因为当前报告标题仍为“响应摘要”，且报告服务没有再次调用脱敏函数。

- [ ] **Step 3: 最小实现**

在 `server/services/report-service.js` 添加导入，并仅修改 API 证据模板：

```js
import { redactSecrets } from './cms-crypto.js';

function apiEvidenceMarkup(step) {
  if (!step.api) return evidenceMarkup(step.runId || '', step);
  const api = step.api;
  const request = redactSecrets(api.request);
  const response = redactSecrets(api.response);
  return `<div class="api-evidence"><strong>${escapeHtml(api.action)} · HTTP ${escapeHtml(api.httpStatus)} · 业务状态 ${escapeHtml(api.businessStatus)} · ${escapeHtml(api.durationMs)}ms</strong><details><summary>请求摘要</summary><pre>${escapeHtml(JSON.stringify(request, null, 2))}</pre></details><details><summary>解密后响应</summary><pre>${escapeHtml(JSON.stringify(response, null, 2))}</pre></details></div>`;
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test -- tests/app.test.js tests/cms-crypto.test.js tests/cms-api-runner.test.js`

Expected: PASS；HTML 中显示解密后响应和星号掩码，不包含测试中的明文敏感值。

- [ ] **Step 5: 提交**

```bash
git add server/services/report-service.js tests/app.test.js
git commit -m "feat: show redacted decrypted API responses"
```

### Task 3: 写入并执行方舟社区发帖的 config 用例

**Files:**
- Modify: SQLite 中的运行时测试资产与运行记录，仅通过现有 HTTP API 创建；不修改源码。
- Verify: `http://127.0.0.1:4173/api/projects`、`/api/cases`、`/api/cases/:id/runs`、`/api/runs/:id/report`。

**Interfaces:**
- Consumes: `POST /api/cases`，包含项目 ID、API 用例元数据和结构化请求步骤。
- Produces: 一个归属“方舟社区发帖”的 API 用例和一个持久化运行记录，其中 `run.steps[0].api.response` 是已脱敏的解密业务响应。

- [ ] **Step 1: 检查 CMS 运行环境与项目**

Run: `curl -fsS http://127.0.0.1:4173/api/health && curl -fsS http://127.0.0.1:4173/api/projects`

Expected: `cmsRunner.ready` 为 `true`，并能找到名称为“方舟社区发帖”的项目。若未就绪，仅记录缺失环境变量名称，不读取或显示变量值。

- [ ] **Step 2: 用现有 API 幂等写入 config 用例**

运行一个不输出环境变量或响应正文的 Node 脚本：读取 `CMS_BASE_URL` 作为 `baseUrl`，根据项目名称定位项目，复用或创建名为“CMS config 解密验证”的 API 用例；请求步骤固定为：

```js
{
  id: 'config',
  kind: 'apiRequest',
  instruction: '读取社区发布配置',
  request: {
    action: 'config',
    method: 'POST',
    payload: {},
    expectedStatus: 1,
    expectedJson: [],
    extract: {},
    safety: 'readonly'
  }
}
```

脚本仅打印用例 ID 和 HTTP 创建或更新状态，不打印 `baseUrl`、请求 body 或任何 CMS 配置。

- [ ] **Step 3: 执行单条用例并取得报告**

用 `POST /api/cases/:id/runs` 发起运行，查询 `GET /api/runs/:id`，再请求 `GET /api/runs/:id/report`。仅校验并记录以下非敏感条件：运行状态、步骤动作为 `config`、报告包含“解密后响应”和 `********`；不得输出报告正文。

- [ ] **Step 4: 验收运行证据**

确认执行器调用顺序为一次懒登录后一次 `config`，运行变量为空且 API 证据没有明文敏感字段。若 CMS 认证、网络、解密或业务状态失败，保留平台生成的已脱敏失败报告，并记录失败类别，不重试写操作。

- [ ] **Step 5: 提交仅代码变更**

```bash
git status --short
git add server/services/cms-crypto.js server/services/report-service.js tests/cms-crypto.test.js tests/cms-api-runner.test.js tests/app.test.js
git commit -m "feat: add redacted CMS config reporting"
```

不提交 `.env`、SQLite 数据库、证据目录、运行报告、`.DS_Store` 或任何运行时凭据。
