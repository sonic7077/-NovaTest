# 一日女友报告契约修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正一日女友匿名鉴权、业务失败和兼容性用例的执行语义，使批次报告只保留真实失败。

**Architecture:** `DaygfApiRunner` 根据 `request.auth` 决定会话来源，`none` 与 `invalid` 均与共享 session 隔离。用例种子以现有 `expectedStatus`、`expectedJson` 表达服务端的 HTTP 200 业务错误契约和兼容性成功契约，不新增数据库字段。

**Tech Stack:** Node.js ESM、原生 fetch、SQLite、Vitest。

## Global Constraints

- 同一批次的正常 `daygf` 会话请求只登录一次。
- `auth: none` 不得发送登录 Token；`auth: invalid` 仅发送固定错误 Token。
- 不更改服务端，不发起删除或新增高风险写操作。
- 不触碰当前未提交的 Web UI 自动化改动。

---

### Task 1: 修复匿名请求的 session 隔离

**Files:**
- Modify: `server/runners/daygf-api-runner.js:151-170`
- Modify: `tests/daygf-api-runner.test.js`

**Interfaces:** `execute(step, context)` 对 `auth: none` 发出不含 `x-token` 和 `authorization` 的请求；普通会话请求仍复用 `context.apiSession.token`。

- [ ] **Step 1: 增加失败回归测试**

```js
it('keeps a no-token probe anonymous when a shared session already has a token', async () => {
  const calls = [];
  const runner = new DaygfApiRunner({ config, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response(401, { ok: false });
  }});
  const context = { testCase: { baseUrl: config.baseUrl }, variables: {}, apiSession: { token: 'private-jwt' } };
  await runner.execute(step('/api/me', { auth: 'none', expectedStatus: 401 }), context);
  expect(calls[0].options.headers).not.toHaveProperty('x-token');
  expect(calls[0].options.headers).not.toHaveProperty('authorization');
});
```

- [ ] **Step 2: 运行回归测试，确认 RED**

Run: `npm test -- --run tests/daygf-api-runner.test.js`  
Expected: 新测试失败，因为现有实现从共享 session 读取 Token。

- [ ] **Step 3: 最小实现**

```js
const token = request.auth === 'invalid'
  ? 'invalid-token'
  : request.auth === 'none'
    ? undefined
    : session.token;
```

保留原有的请求头展开逻辑，使 `token` 为 `undefined` 时不发送任何认证头。

- [ ] **Step 4: 运行 Daygf runner 测试，确认 GREEN**

Run: `npm test -- --run tests/daygf-api-runner.test.js`  
Expected: 全部通过。

### Task 2: 修正种子用例的服务契约

**Files:**
- Modify: `server/seed/daygf-cases.js`
- Modify: `tests/daygf-cases.test.js`

**Interfaces:** `businessFailure` 定义 `expectedStatus: 200` 与 `expectedJson: [{ path: '$.ok', equals: false }]`；`compatibleRead` 定义 `auth: 'none'`、`expectedStatus: 200` 与 `$.ok === true`。

- [ ] **Step 1: 增加失败的矩阵测试**

```js
it('models service business rejections and tolerant reads with their actual contracts', () => {
  const byId = Object.fromEntries(daygfCases({ projectId: 'p', baseUrl: 'https://daygf.example.test' }).map((item) => [item.id, item]));
  expect(byId['daygf-content-12'].steps[0].request).toMatchObject({ expectedStatus: 200, expectedJson: [{ path: '$.ok', equals: false }] });
  expect(byId['daygf-content-10'].steps[0].request).toMatchObject({ auth: 'none', expectedStatus: 200, expectedJson: [{ path: '$.ok', equals: true }] });
});
```

- [ ] **Step 2: 运行种子测试，确认 RED**

Run: `npm test -- --run tests/daygf-cases.test.js`  
Expected: 新断言失败，因为当前反例期望 401 或 4xx。

- [ ] **Step 3: 最小实现**

在 `server/seed/daygf-cases.js` 增加：

```js
const businessFailure = [{ path: '$.ok', equals: false }];
const compatibleRead = [{ path: '$.ok', equals: true }];
```

将 4 个资源不存在的业务拒绝用例改为 `expectedStatus: 200, expectedJson: businessFailure`；将 12 个兼容性查询改为 `expectedStatus: 200, expectedJson: compatibleRead`。不修改需要验证真实 401 的鉴权负例，尤其是不认证写操作与订单状态查询。

- [ ] **Step 4: 运行种子测试，确认 GREEN**

Run: `npm test -- --run tests/daygf-cases.test.js`  
Expected: 全部通过，矩阵仍为 110 条。

### Task 3: 全量验证与真实批次复验

**Files:**
- Modify: `data/novatest.db`（由受控种子幂等更新）

- [ ] **Step 1: 运行完整单元测试**

Run: `npm test`  
Expected: 退出码 0。

- [ ] **Step 2: 启动本地服务并确认项目资产同步**

Run: `npm start`  
Expected: 服务监听 `4173`，一日女友项目仍有 110 条 API 用例。

- [ ] **Step 3: 通过平台 API 执行一日女友完整批次**

使用本地管理员会话创建并轮询批次。确认报告中匿名鉴权负例返回 401，原 32 条契约不匹配用例转为通过；如仍有失败，仅按实际响应记录为服务端问题或环境数据前置不足。

- [ ] **Step 4: 提交**

```bash
git add server/runners/daygf-api-runner.js server/seed/daygf-cases.js tests/daygf-api-runner.test.js tests/daygf-cases.test.js docs/superpowers/specs/2026-08-13-daygf-report-contract-correction-design.md docs/superpowers/plans/2026-08-13-daygf-report-contract-correction.md
git commit -m "fix: correct daygf API report contracts"
```
