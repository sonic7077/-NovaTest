# 工作台、执行中心与质量报告 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将执行改为持久化的异步任务，并提供真实数据驱动的质量工作台、执行中心和质量报告页面，同时保留测试资产与 AI 模型配置入口。

**Architecture:** `ExecutionService` 在 Node 进程内接收并持久化 queued 任务，随后异步运行；`RunService` 在运行、步骤与重试状态变化时把真实快照写入 store。SQLite 保存项目和目标快照并提供工作台、执行和报告聚合；单页前端通过哈希路由展示三个独立页面，仅在执行中心存在活跃任务时轮询。

**Tech Stack:** Node.js 22、Express 5、`node:sqlite`、Vitest 3、原生 HTML/CSS/JavaScript、Lucide。

## Global Constraints

- Web UI 与 CMS API runner 语义不变；同一 API 批次仅创建一次 CMS session。
- 报告与证据必须保留业务解包内容，同时掩码 token、密码、验证码、Google 密钥以及加密/签名配置。
- 时间以 `Asia/Shanghai` 展示；工作台默认统计最近 7 天的终态运行。
- 不新增外部队列、数据库或图表依赖；图表使用 HTML/CSS/SVG。
- 不提交 `.env`、SQLite 数据库、`evidence/`、`.DS_Store`、`.superpowers/`。
- 测试资产和 AI 模型配置保持为侧栏一级入口；本计划不改变 Midscene 凭据或模型配置字段。

---

## File Structure

| 路径 | 责任 |
| --- | --- |
| `server/services/run-service.js` | 创建 queued 运行，并通过回调发布真实运行、步骤和重试状态。 |
| `server/services/execution-service.js` | 持久化后调度单条与批量任务，批量串行、复用 API session、处理未捕获异常。 |
| `server/services/batch-service.js` | 执行已创建的批量任务，不参与 HTTP 同步响应。 |
| `server/storage/sqlite-store.js` | 快照迁移、执行/报告/工作台聚合查询和中断任务收尾。 |
| `server/app.js` | 注入调度服务，提交接口返回 queued 对象，并暴露聚合 API。 |
| `tests/run-service.test.js` | 运行状态和重试快照测试。 |
| `tests/execution-service.test.js` | 异步队列、串行批次、session 复用与异常落盘测试。 |
| `tests/sqlite-store.test.js` | 快照迁移与真实统计/筛选测试。 |
| `tests/app.test.js` | HTTP queued 契约、轮询可观测状态、聚合 API 测试。 |
| `index.html`, `app.js`, `style.css` | 工作台、执行中心、质量报告的路由和界面。 |
| `tests/styles.test.js` | 路由、关键元素和响应式样式回归。 |

### Task 1: 发布运行过程快照

**Files:**
- Modify: `server/services/run-service.js`
- Modify: `tests/run-service.test.js`

**Interfaces:**
- Produces: `createQueuedRun(testCase, { batchId, batchPosition }): Run`。
- Produces: `start(testCase, { apiSession, run, onUpdate }): Promise<Run>`。
- Consumes: 既有 runner `execute(step, context)` 和既有两次重试行为。

- [ ] **Step 1: 写入失败测试**

```js
it('publishes queued, running, step and terminal snapshots', async () => {
  const updates = [];
  const service = new RunService({ execute: async () => ({}) });
  const queued = service.createQueuedRun(testCase);

  await service.start(testCase, {
    run: queued,
    onUpdate: (run) => updates.push(structuredClone(run))
  });

  expect(updates.map((run) => run.status)).toEqual(['running', 'running', 'running', 'passed']);
  expect(updates[1].steps[0]).toMatchObject({ status: 'running', attempts: 1 });
  expect(updates.at(-1)).toMatchObject({ status: 'passed', finishedAt: expect.any(String) });
});
```

- [ ] **Step 2: 验证测试为红**

Run: `npm test -- tests/run-service.test.js`

Expected: FAIL，原因是 `createQueuedRun` 不存在。

- [ ] **Step 3: 编写最小实现**

```js
createQueuedRun(testCase, { batchId, batchPosition } = {}) {
  return {
    id: crypto.randomUUID(), caseId: testCase.id, caseName: testCase.name,
    projectId: testCase.projectId, target: testCase.target, batchId, batchPosition,
    status: 'queued', startedAt: null, finishedAt: null, variables: {},
    steps: testCase.steps.map((step) => ({
      id: step.id, status: 'queued', attempts: 0, logs: [], screenshots: []
    }))
  };
}
```

In `start`, reuse a supplied queued run or create one. Before runner execution, set run/step status to `running`, set `startedAt`, and invoke `onUpdate(structuredClone(run))`. Publish after retry-log insertion, step terminal assignment and final run terminal assignment. Preserve API evidence, screenshot evidence and the existing retry count.

- [ ] **Step 4: 写入重试失败测试**

```js
it('publishes retry and failed terminal snapshots', async () => {
  const updates = [];
  const service = new RunService({ execute: async () => { throw new Error('页面未就绪'); } });

  await service.start(testCase, {
    run: service.createQueuedRun(testCase),
    onUpdate: (run) => updates.push(structuredClone(run))
  });

  expect(updates.some((run) => run.steps[0].logs.some((log) => log.message.includes('retrying once')))).toBe(true);
  expect(updates.at(-1)).toMatchObject({ status: 'failed', steps: [{ status: 'failed', attempts: 2 }] });
});
```

- [ ] **Step 5: 验证为绿并提交**

Run: `npm test -- tests/run-service.test.js`

Expected: PASS。

```bash
git add server/services/run-service.js tests/run-service.test.js
git commit -m "feat: publish run execution progress"
```

### Task 2: 保存历史快照与质量聚合

**Files:**
- Modify: `server/storage/sqlite-store.js`
- Modify: `tests/sqlite-store.test.js`

**Interfaces:**
- Produces: `listExecutions({ projectId, target, status }): ExecutionSummary[]`。
- Produces: `getDashboard({ range, now }): DashboardData`。
- Produces: `listReports({ projectId, target, status, range, now }): ReportSummary[]`。
- Produces: `failInterruptedExecutions(message): number`。

- [ ] **Step 1: 写入失败测试**

```js
it('persists project and target snapshots and returns execution progress', () => {
  store.saveRun({
    id: 'run-1', caseId: webCase.id, caseName: webCase.name,
    projectId, target: 'web', status: 'running',
    startedAt: '2026-07-19T00:00:00.000Z', finishedAt: null, variables: {},
    steps: [
      { id: 'step-1', status: 'passed', attempts: 1, logs: [] },
      { id: 'step-2', status: 'queued', attempts: 0, logs: [] }
    ]
  });

  expect(store.listExecutions({ projectId })).toMatchObject([
    { id: 'run-1', target: 'web', completedSteps: 1, totalSteps: 2, status: 'running' }
  ]);
});
```

- [ ] **Step 2: 验证测试为红**

Run: `npm test -- tests/sqlite-store.test.js`

Expected: FAIL，原因是 `listExecutions` 或 target/project snapshot 缺失。

- [ ] **Step 3: 增加可重复 schema 迁移**

```js
function migrateExecutionSnapshotSchema() {
  const runColumns = db.prepare('PRAGMA table_info(test_runs)').all().map((column) => column.name);
  if (!runColumns.includes('project_id')) db.exec('ALTER TABLE test_runs ADD COLUMN project_id TEXT');
  if (!runColumns.includes('target')) db.exec('ALTER TABLE test_runs ADD COLUMN target TEXT');
  const batchColumns = db.prepare('PRAGMA table_info(test_batches)').all().map((column) => column.name);
  if (!batchColumns.includes('target')) db.exec('ALTER TABLE test_batches ADD COLUMN target TEXT');
  db.exec(`UPDATE test_runs SET project_id = (SELECT project_id FROM test_cases WHERE test_cases.id = test_runs.case_id) WHERE project_id IS NULL`);
  db.exec(`UPDATE test_runs SET target = (SELECT target FROM test_cases WHERE test_cases.id = test_runs.case_id) WHERE target IS NULL`);
  db.exec('CREATE INDEX IF NOT EXISTS test_runs_dashboard_idx ON test_runs(finished_at, project_id, target, status)');
}
```

Extend `hydrateRun` and `writeRun` with `projectId`/ `target`; extend batch hydration/write with `target`. Use SQL `COUNT`/ `SUM` for step totals and completed steps. `getDashboard` must include only passed/failed runs with `finished_at` in range and return raw counts, arrays and duration milliseconds. `listReports` returns terminal batches plus terminal runs without a batch. `failInterruptedExecutions` atomically marks queued/running records failed, sets finish times and preserves existing evidence.

- [ ] **Step 4: 加入聚合与恢复测试**

```js
it('counts only terminal runs in the selected dashboard range', () => {
  expect(store.getDashboard({ range: '7d', now: '2026-07-19T12:00:00.000Z' }))
    .toMatchObject({ completedRuns: 2, passedRuns: 1, failedRuns: 1 });
});

it('marks queued work interrupted by restart as failed', () => {
  expect(store.failInterruptedExecutions('服务重启导致任务中断')).toBeGreaterThan(0);
  expect(store.getRun('run-1')).toMatchObject({ status: 'failed', finishedAt: expect.any(String) });
});
```

- [ ] **Step 5: 验证为绿并提交**

Run: `npm test -- tests/sqlite-store.test.js`

Expected: PASS。

```bash
git add server/storage/sqlite-store.js tests/sqlite-store.test.js
git commit -m "feat: persist execution snapshots and dashboard data"
```

### Task 3: 异步调度与 HTTP 契约

**Files:**
- Create: `server/services/execution-service.js`
- Modify: `server/services/batch-service.js`
- Modify: `server/app.js`
- Create: `tests/execution-service.test.js`
- Modify: `tests/app.test.js`

**Interfaces:**
- Produces: `ExecutionService.queueRun(testCase): Run`。
- Produces: `ExecutionService.queueBatch({ name, projectId, target, caseIds, cases }): Batch`。
- `schedule` 构造参数默认 `setImmediate`，可在测试中替换。
- Produces: `GET /api/executions`、`GET /api/dashboard`、`GET /api/reports`。

- [ ] **Step 1: 写入失败的异步任务测试**

```js
it('returns a queued batch before a runner step resolves', async () => {
  let release;
  const runner = { execute: () => new Promise((resolve) => { release = resolve; }) };
  const service = new ExecutionService({ runner, store });
  const batch = service.queueBatch({
    name: '异步回归', projectId: 'default-project', target: 'web',
    caseIds: [firstCase.id], cases: [firstCase]
  });

  expect(batch).toMatchObject({ status: 'queued', runIds: [] });
  await new Promise((resolve) => setImmediate(resolve));
  expect(store.getBatch(batch.id)).toMatchObject({ status: 'running' });
  release({});
});
```

- [ ] **Step 2: 验证测试为红**

Run: `npm test -- tests/execution-service.test.js`

Expected: FAIL，无法导入 `ExecutionService`。

- [ ] **Step 3: 创建调度服务**

```js
export class ExecutionService {
  constructor({ runner, store, schedule = setImmediate }) {
    this.runner = runner; this.store = store; this.schedule = schedule;
    this.runService = new RunService(runner);
  }
  queueRun(testCase) {
    const run = this.runService.createQueuedRun(testCase);
    this.store.saveRun(run);
    this.schedule(() => this.executeRun(testCase, run));
    return run;
  }
  queueBatch(input) {
    const batch = { id: crypto.randomUUID(), ...input, status: 'queued', runIds: [], startedAt: null, finishedAt: null };
    this.store.saveBatch(batch);
    this.schedule(() => this.executeBatch(batch, input.cases));
    return batch;
  }
}
```

`executeRun` must call `RunService.start` with `onUpdate: (run) => store.saveRun(run)`; unexpected exceptions become saved failed terminal runs. `executeBatch` marks batch running, creates exactly one API session for API batches, calls a refactored serial `BatchService.execute`, saves every progress callback, then saves a passed/failed terminal batch. The batch service must continue after a failed case.

- [ ] **Step 4: 加入 session 和失败继续测试**

```js
it('shares one API session and persists each run in batch order', async () => {
  const api = { createSession: vi.fn(() => ({})), execute: vi.fn(async () => ({})) };
  const service = new ExecutionService({ runner: { api }, store });
  const batch = service.queueBatch({ name: '接口查询', projectId: 'default-project', target: 'api', caseIds, cases });

  await waitForTerminal(store, batch.id);
  expect(api.createSession).toHaveBeenCalledTimes(1);
  expect(store.getBatch(batch.id).runIds).toHaveLength(cases.length);
});
```

- [ ] **Step 5: 写入 API 契约测试并实现 Express 路由**

```js
const submitted = await request(app).post('/api/batches').send({ caseIds: [created.id] }).expect(202);
expect(submitted.body).toMatchObject({ status: 'queued', finishedAt: null });
await request(app).get('/api/executions?status=queued').expect(200);
await request(app).get('/api/dashboard?range=7d').expect(200).expect(({ body }) => expect(body).toHaveProperty('daily'));
await request(app).get('/api/reports?range=30d').expect(200);
```

In `createApp`, call `store.failInterruptedExecutions('服务重启导致任务中断')` once, replace direct synchronous run/batch starts with `ExecutionService` queue methods, preserve all validation/report/evidence routes, and add the three read-only aggregation routes.

- [ ] **Step 6: 验证为绿并提交**

Run: `npm test -- tests/execution-service.test.js tests/batch-service.test.js tests/app.test.js`

Expected: PASS。

```bash
git add server/services/execution-service.js server/services/batch-service.js server/app.js tests/execution-service.test.js tests/app.test.js
git commit -m "feat: queue observable test executions"
```

### Task 4: 真实质量工作台

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`
- Modify: `tests/styles.test.js`

**Interfaces:**
- Produces: `loadDashboard(range)` and `renderDashboard(data)`。
- Consumes: `GET /api/dashboard?range=today|7d|30d` as the only metric source.
- Produces: `data-dashboard-range` selector with default `7d`.

- [ ] **Step 1: 写入失败的页面结构测试**

```js
expect(html).toContain('data-dashboard-range="7d"');
expect(html).toContain('id="dashboardTrend"');
expect(html).toContain('id="dashboardTargetBreakdown"');
expect(html).not.toContain('id="runLog"');
expect(html).not.toContain('id="progressBar"');
expect(html).toContain('href="#/assets"');
expect(html).toContain('AI 模型配置');
```

- [ ] **Step 2: 验证测试为红**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL，缺少范围选择器和图表容器。

- [ ] **Step 3: 替换首页过程内容为质量概览**

Add metric IDs `dashboardCompletedRuns`, `dashboardPassRate`, `dashboardAverageDuration`, `dashboardCaseCount`; add a 今日/7 天/30 天 segmented selector; add accessible SVG/empty containers for daily trend and target breakdown; add recent failures and recent report lists. Delete only dashboard execution state, strategy and report-preview markup. Keep test assets and AI model configuration as visible primary navigation items.

- [ ] **Step 4: 写入渲染测试并实现数据绑定**

```js
it('renders dashboard metrics from API data without static values', () => {
  document.body.innerHTML = dashboardFixture;
  renderDashboard({ completedRuns: 4, passedRuns: 3, failedRuns: 1, passRate: 75, averageDurationMs: 1250, automatedCaseCount: 6, daily: [], targets: [], recentFailures: [], recentReports: [] });
  expect(document.querySelector('#dashboardPassRate').textContent).toBe('75.0%');
  expect(document.querySelector('#dashboardCompletedRuns').textContent).toBe('4');
});
```

Use `fetch`, DOM `textContent` and escaped DOM nodes. Draw SVG from `daily` and explicitly display “所选时间范围内暂无已完成执行记录” for empty results. No hard-coded metrics, trends or test report values may remain.

- [ ] **Step 5: 加入响应式图表布局并验证**

```css
.quality-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr); gap: 18px; }
.chart-empty { min-height: 220px; display: grid; place-items: center; color: var(--muted); }
@media (max-width: 900px) { .quality-grid { grid-template-columns: 1fr; } }
```

Run: `npm test -- tests/styles.test.js`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add index.html app.js style.css tests/styles.test.js
git commit -m "feat: render data-driven quality dashboard"
```

### Task 5: 执行中心与质量报告页面

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`
- Modify: `tests/styles.test.js`

**Interfaces:**
- Produces routes `#/executions` and `#/reports`。
- Produces `loadExecutions(filters)`, `startExecutionPolling()`, `stopExecutionPolling()`, `loadReports(filters)`。
- Active polling interval is 1500 ms and stops outside execution center, while hidden, or after all tasks become terminal.

- [ ] **Step 1: 写入失败的路由测试**

```js
expect(html).toContain('href="#/executions"');
expect(html).toContain('href="#/reports"');
expect(html).toContain('data-route-view="executions"');
expect(html).toContain('data-route-view="reports"');
expect(script).toContain("route === '#/executions'");
expect(script).toContain('function startExecutionPolling()');
expect(script).toContain('function loadReports(');
```

- [ ] **Step 2: 验证测试为红**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL，缺少路由与执行轮询函数。

- [ ] **Step 3: 实现执行中心**

Add project/type/status filters, task list, selected detail pane and empty state. `loadExecutions` builds a query from non-empty filters and preserves the selected `focus` ID. It renders service-provided queued/running/passed/failed badges, case/step completion, current case, runner logs and only runner-provided API/screenshot evidence. Trigger polling with:

```js
let executionPollId;
function startExecutionPolling() {
  stopExecutionPolling();
  executionPollId = window.setInterval(() => {
    if (document.hidden || currentRouteView !== 'executions') return stopExecutionPolling();
    loadExecutions(currentExecutionFilters);
  }, 1500);
}
function stopExecutionPolling() {
  if (executionPollId) window.clearInterval(executionPollId);
  executionPollId = undefined;
}
```

After any saved-case, API-debug or batch request returns queued, navigate to `#/executions?focus=<encoded id>`; do not wait for execution completion.

- [ ] **Step 4: 实现质量报告索引**

Add project/type/status/range filters and a responsive report table: type, name, project, status, local start/end, duration, pass/fail counts and explicit report button. `loadReports` requests `/api/reports`; button click opens only the returned report URL using `window.open(url, '_blank', 'noopener')`. Render a clear no-terminal-report state.

- [ ] **Step 5: 样式、全量验证与浏览器验收**

```css
.execution-layout { display: grid; grid-template-columns: minmax(320px, .9fr) minmax(0, 1.4fr); gap: 18px; }
.execution-progress > span { display: block; height: 100%; transition: width .18s ease; }
.report-table { overflow-x: auto; }
@media (max-width: 960px) { .execution-layout { grid-template-columns: 1fr; } }
```

Run: `npm test -- tests/styles.test.js`

Expected: PASS。

Run: `npm test`

Expected: PASS with zero failures.

Run: `npm start`

Manually verify at `http://127.0.0.1:4173/` on desktop and mobile: dashboard ranges use real results and empty states; assets, model configuration, execution center and report routes are usable; a controlled task visibly transitions queued → running → terminal; report filters work and report output remains redacted.

- [ ] **Step 6: 提交**

```bash
git add index.html app.js style.css tests/styles.test.js
git commit -m "feat: add execution center and report index"
```

## Plan Self-Review

- Spec coverage: Task 1 handles real progress; Tasks 2-3 handle persistence, async execution, recovery and read APIs; Task 4 implements the real-data-only dashboard; Task 5 implements execution center, report index, filtering, polling and responsive UI.
- No placeholders: Every task has exact files, interfaces, failing tests, verification commands and commit boundaries.
- Type consistency: The `ExecutionService`, store aggregate methods, API query names and front-end routes use the same identifiers throughout.
