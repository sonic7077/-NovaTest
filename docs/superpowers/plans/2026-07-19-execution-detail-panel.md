# 动态执行详情面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在执行中心右侧提供随任务状态更新的结论、进度、时间线和报告入口。

**Architecture:** 服务端为已选任务提供完整运行与步骤详情，前端在既有轮询周期内刷新当前详情。纯前端结论函数根据运行状态、失败步骤和重试日志生成通过、失败或需关注状态；页面只渲染已脱敏的现有证据。

**Tech Stack:** Express 5、Node.js 22、Vitest 3、原生 HTML/CSS/JavaScript、Lucide。

## Global Constraints

- 不改变 Web UI、CMS API runner 或批量 session 复用。
- API 证据必须继续掩码认证与加密配置字段。
- 不引入新的依赖或图表库；详情只使用原生 DOM/CSS。
- 保留现有 1.5 秒轮询和报告 URL。
- 不提交 `.env`、数据库、`evidence/`、`.DS_Store`、`.superpowers/`。

---

### Task 1: 任务详情 API

**Files:**
- Modify: `server/app.js`
- Modify: `tests/app.test.js`

**Interfaces:**
- Produces: `GET /api/executions/:id` returning `{ kind, task, runs }`.
- Consumes: existing `store.getBatch(id)`, `store.getRun(id)`, and persisted run steps.

- [ ] **Step 1: Write the failing API test**

```js
await request(app).get('/api/executions/batch-1').expect(200).expect(({ body }) => {
  expect(body).toMatchObject({
    kind: 'batch',
    task: { id: 'batch-1', status: 'failed' },
    runs: [{ id: 'run-1', steps: [{ id: 's1', status: 'failed', error: 'missing' }] }]
  });
});
await request(app).get('/api/executions/missing').expect(404);
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- tests/app.test.js`

Expected: FAIL with HTTP 404 for the unimplemented detail route.

- [ ] **Step 3: Add the detail route**

```js
app.get('/api/executions/:id', (req, res) => {
  const batch = store.getBatch(req.params.id);
  if (batch) return res.json({ kind: 'batch', task: batch, runs: batch.runIds.map((id) => store.getRun(id)).filter(Boolean) });
  const run = store.getRun(req.params.id);
  if (run) return res.json({ kind: 'run', task: run, runs: [run] });
  return res.status(404).json({ error: 'execution not found' });
});
```

Place this route after `GET /api/executions` and before report routes.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- tests/app.test.js`

Expected: PASS.

```bash
git add server/app.js tests/app.test.js
git commit -m "feat: expose execution detail snapshots"
```

### Task 2: 结论面板与步骤时间线

**Files:**
- Modify: `app.js`
- Modify: `style.css`
- Modify: `tests/styles.test.js`

**Interfaces:**
- Produces: `getExecutionConclusion(detail)` returning `{ tone, title, description, firstFailure, retryCount }`.
- Produces: `renderExecutionDetail(detail)`, called from `loadExecutions`.
- Consumes: `GET /api/executions/:id`.

- [ ] **Step 1: Write failing structure tests**

```js
expect(html).toContain('id="executionDetail"');
expect(script).toContain('function getExecutionConclusion(');
expect(script).toContain('async function loadExecutionDetail(');
expect(stylesheet).toContain('.execution-conclusion');
expect(stylesheet).toContain('.execution-timeline');
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL because the conclusion and timeline functions/styles do not exist.

- [ ] **Step 3: Implement conclusion classification and detail fetch**

```js
function getExecutionConclusion(detail) {
  const steps = detail.runs.flatMap((run) => run.steps || []);
  const firstFailure = steps.find((step) => step.status === 'failed');
  const retryCount = steps.reduce((count, step) => count + Math.max(0, (step.attempts || 0) - 1), 0);
  if (detail.task.status === 'failed') return { tone: 'failed', title: '执行失败', description: firstFailure?.error || '存在未通过步骤', firstFailure, retryCount };
  if (['queued', 'running'].includes(detail.task.status)) return { tone: 'running', title: detail.task.status === 'queued' ? '等待执行' : '正在执行', description: '执行进度会自动刷新', firstFailure: null, retryCount };
  if (retryCount) return { tone: 'attention', title: '执行完成，需关注', description: `共发生 ${retryCount} 次重试`, firstFailure: null, retryCount };
  return { tone: 'passed', title: '执行通过', description: '所有已执行步骤均通过', firstFailure: null, retryCount: 0 };
}
```

Implement `loadExecutionDetail(id)` to fetch the new route. Replace the textual `executionDetail.innerHTML` with conclusion, progress, timeline and terminal report action DOM nodes. API timeline rows may show action, HTTP status, business status and duration; Web rows may show registered screenshot count. Use textContent for dynamic values.

- [ ] **Step 4: Add responsive visual rules**

```css
.execution-conclusion { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center; padding: 16px 0; border-bottom: 1px solid var(--line); }
.execution-timeline { display: grid; gap: 10px; margin-top: 16px; }
.timeline-step { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 9px; }
.execution-conclusion.attention { color: #805b13; }
```

Use passed/failed/attention/running color variants, fixed-size status markers, and a narrow mobile single-column adaptation. Do not use nested cards.

- [ ] **Step 5: Verify, browser-check, and commit**

Run: `npm test -- tests/styles.test.js tests/app.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS with zero failures.

Open `http://127.0.0.1:4173/#/executions` and verify a passed batch, a failed task and a retrying task show their respective conclusions, live progress and report action.

```bash
git add app.js style.css tests/styles.test.js
git commit -m "feat: render dynamic execution conclusions"
```

## Plan Self-Review

- Spec coverage: Task 1 supplies selected task runs/steps; Task 2 maps every specified conclusion state and renders progress, timeline, evidence summary, report action and mobile style.
- No placeholders: each task includes paths, concrete API/function contracts, tests, commands and commits.
- Type consistency: `/api/executions/:id`, `getExecutionConclusion`, `loadExecutionDetail` and `renderExecutionDetail` use the same detail shape.
