# 执行报告分组与固定总量 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 批次执行从创建时固定用例与步骤总量，执行详情将报告入口置顶，批次报告按失败、跳过、通过分组展示。

**Architecture:** `test_batches` 持久化计划总量，内存存储和 SQLite 查询都优先读取该总量；旧批次在字段为空或零时回退至既有运行记录计数。报告渲染把 runs 稳定分区后输出，前端详情消费同一计划总量并将报告按钮附着于结论区域。

**Tech Stack:** Node.js ESM、SQLite、Express、原生 DOM、Vitest。

## Global Constraints

- 批次创建时计算并固定 `plannedCaseCount` 和 `plannedStepCount`。
- 历史批次数据可读，字段缺失或为零时回退到原有统计。
- 批次报告区块顺序固定为失败、跳过、通过，区块内保留原始执行顺序。
- 报告入口仅在终态任务的执行详情顶部显示。
- 不修改单条报告、批次串行执行、测试资产、模型配置或 Web UI 自动化执行器。
- 不触碰当前未提交的 `server/runners/web-runner.js`、`tests/web-runner.test.js` 与运行产物。

---

### Task 1: 持久化批次计划总量并在执行列表使用它

**Files:**
- Modify: `server/services/execution-service.js:31-45`
- Modify: `server/services/batch-service.js:14-29`
- Modify: `server/app.js:37-40,104`
- Modify: `server/storage/sqlite-store.js:44-51,285-294,480-520,632-644`
- Modify: `server/storage/file-store.js:86-92`
- Modify: `tests/execution-service.test.js`
- Modify: `tests/sqlite-store.test.js`

**Interfaces:**
- Batch objects have `plannedCaseCount: number` and `plannedStepCount: number`.
- `createBatchPlan(cases)` returns `{ plannedCaseCount: cases.length, plannedStepCount: cases.reduce((total, testCase) => total + testCase.steps.length, 0) }`.
- `listExecutions()` returns stable `totalCases` and `totalSteps` using stored plan values when positive.

- [ ] **Step 1: Write failing queue and SQLite tests**

Add to `tests/execution-service.test.js`:

```js
it('fixes batch case and step totals before any run is created', () => {
  const store = createMemoryStore();
  const service = new ExecutionService({ runner: {}, store, schedule: () => {} });
  const second = { ...webCase, id: 'case-2', steps: [...webCase.steps, { id: 's2', kind: 'action', instruction: '检查结果' }] };
  const batch = service.queueBatch({ name: '固定总量', projectId: 'default-project', target: 'web', caseIds: [webCase.id, second.id], cases: [webCase, second] });
  expect(batch).toMatchObject({ plannedCaseCount: 2, plannedStepCount: 3, runIds: [] });
  expect(store.listExecutions().find((item) => item.id === batch.id)).toMatchObject({ totalCases: 2, totalSteps: 3, completedCases: 0, completedSteps: 0 });
});
```

Extend `persists execution snapshots and aggregates terminal quality data` in `tests/sqlite-store.test.js` so its saved batch has `plannedCaseCount: 3, plannedStepCount: 5` and expects `totalCases: 3, totalSteps: 5`, while `completedCases` and `completedSteps` remain based on persisted runs.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --run tests/execution-service.test.js tests/sqlite-store.test.js`  
Expected: the new queue test cannot find plan fields and SQLite totals are still derived from one created run.

- [ ] **Step 3: Implement the batch plan model and migration**

Add the helper in `server/services/execution-service.js`:

```js
function batchPlan(cases) {
  return {
    plannedCaseCount: cases.length,
    plannedStepCount: cases.reduce((total, testCase) => total + testCase.steps.length, 0)
  };
}
```

Spread `...batchPlan(cases)` into both `ExecutionService.queueBatch` and `BatchService.start` batch objects. Preserve these fields in memory and file stores.

In `server/storage/sqlite-store.js`, add a migration after mutation authorization:

```js
function migrateBatchPlanSchema() {
  const columns = db.prepare('PRAGMA table_info(test_batches)').all().map((column) => column.name);
  if (!columns.includes('planned_case_count')) db.exec('ALTER TABLE test_batches ADD COLUMN planned_case_count INTEGER NOT NULL DEFAULT 0');
  if (!columns.includes('planned_step_count')) db.exec('ALTER TABLE test_batches ADD COLUMN planned_step_count INTEGER NOT NULL DEFAULT 0');
  if (db.prepare('PRAGMA user_version').get().user_version < 14) db.exec('PRAGMA user_version = 14');
}
```

Run it at startup. Include the fields in `hydrateBatch`, `writeBatch` insert/upsert and execution SELECT. Use:

```sql
CASE WHEN b.planned_case_count > 0 THEN b.planned_case_count ELSE (SELECT COUNT(*) FROM batch_cases WHERE batch_id = b.id) END AS totalCases,
CASE WHEN b.planned_step_count > 0 THEN b.planned_step_count ELSE (SELECT COUNT(*) FROM run_steps JOIN test_runs ON test_runs.id = run_steps.run_id WHERE test_runs.batch_id = b.id) END AS totalSteps
```

Memory-store batch execution summaries use `batch.plannedCaseCount || batch.caseIds.length` and `batch.plannedStepCount || steps.length`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- --run tests/execution-service.test.js tests/sqlite-store.test.js`  
Expected: all tests pass and total values stay fixed before or during execution.

### Task 2: 按结果状态分组批次报告

**Files:**
- Modify: `server/services/report-service.js:55-105`
- Modify: `tests/app.test.js:529-589`

**Interfaces:** `renderBatchReport(batch, runs)` emits optional sections with anchors `batch-status-failed`, `batch-status-skipped`, `batch-status-passed`; summary chips link to their present section. Each section contains only matching runs, in input order.

- [ ] **Step 1: Write a failing report grouping test**

Add to `tests/app.test.js`:

```js
it('groups batch report runs by final status while retaining order within each group', () => {
  const report = renderBatchReport({ id: 'batch-grouped', name: '状态归类', status: 'failed' }, [
    { id: 'pass-first', caseName: '通过一', status: 'passed', steps: [] },
    { id: 'fail-first', caseName: '失败一', status: 'failed', steps: [] },
    { id: 'skip-first', caseName: '跳过一', status: 'skipped', steps: [] },
    { id: 'pass-second', caseName: '通过二', status: 'passed', steps: [] }
  ]);
  expect(report).toContain('id="batch-status-failed"');
  expect(report).toContain('id="batch-status-skipped"');
  expect(report).toContain('id="batch-status-passed"');
  expect(report.indexOf('失败一')).toBeLessThan(report.indexOf('跳过一'));
  expect(report.indexOf('跳过一')).toBeLessThan(report.indexOf('通过一'));
  expect(report.indexOf('通过一')).toBeLessThan(report.indexOf('通过二'));
  expect(report).toContain('href="#batch-status-failed"');
});
```

- [ ] **Step 2: Run report tests and verify RED**

Run: `npm test -- --run tests/app.test.js`  
Expected: section anchors and grouped ordering assertions fail.

- [ ] **Step 3: Implement stable report sections**

Replace flat `runSections` construction with:

```js
const statusGroups = ['failed', 'skipped', 'passed'].map((status) => ({
  status,
  runs: runs.filter((run) => run.status === status)
})).filter((group) => group.runs.length);
const runSections = statusGroups.map(({ status, runs: groupedRuns }) =>
  `<section id="batch-status-${status}" class="batch-status-group ${status}"><h2>${statusLabel(status)}用例（${groupedRuns.length}）</h2>${groupedRuns.map(runSection).join('')}</section>`
).join('');
```

Make `statusSummary(runs, 'batch-status')` generate `href="#batch-status-${status}"`; retain `run` anchors on every run section. Add concise `.batch-status-group` styles to the existing report CSS string.

- [ ] **Step 4: Run report tests and verify GREEN**

Run: `npm test -- --run tests/app.test.js`  
Expected: report grouping, download, redaction and other application tests pass.

### Task 3: 执行详情顶部报告入口与稳定步骤进度

**Files:**
- Modify: `app.js:1148-1205`
- Modify: `style.css:345-354`
- Modify: `tests/styles.test.js`

**Interfaces:** `renderExecutionDetail(detail)` derives `plannedCases = detail.task.plannedCaseCount || detail.task.caseIds?.length || detail.runs.length || 1` and `plannedSteps = detail.task.plannedStepCount || steps.length`; terminal detail appends the report button to `execution-conclusion`, and never appends `execution-detail-actions` below the timeline.

- [ ] **Step 1: Extend source-level UI contract test**

Add expectations to `tests/styles.test.js`:

```js
expect(script).toContain('detail.task.plannedStepCount || steps.length');
expect(script).toContain('detail.task.plannedCaseCount || detail.task.caseIds?.length');
expect(script).toContain('summary.append(conclusionIcon, conclusionCopy, conclusionState, actions);');
expect(script).not.toContain('container.append(actions);');
expect(stylesheet).toContain('.execution-conclusion-actions');
```

- [ ] **Step 2: Run stylesheet test and verify RED**

Run: `npm test -- --run tests/styles.test.js`  
Expected: new execution-detail assertions fail.

- [ ] **Step 3: Implement the execution detail rendering**

In `app.js`, calculate progress against planned values:

```js
const plannedCases = detail.task.plannedCaseCount || detail.task.caseIds?.length || detail.runs.length || 1;
const plannedSteps = detail.task.plannedStepCount || steps.length;
const percent = plannedSteps ? Math.round(completedSteps / plannedSteps * 100) : 0;
```

Display `${passedSteps}/${plannedSteps}`. Before appending `summary`, construct terminal-only `actions` with class `execution-conclusion-actions`, containing the existing report button, then call `summary.append(conclusionIcon, conclusionCopy, conclusionState, actions)`. Delete the former bottom action construction.

Add `.execution-conclusion-actions` styles that keep the report button right-aligned on desktop and wrap cleanly below conclusion text on narrow screens. Remove obsolete `.execution-detail-actions` rules only after no source uses that class.

- [ ] **Step 4: Run UI test and verify GREEN**

Run: `npm test -- --run tests/styles.test.js`  
Expected: all source-level UI assertions pass.

### Task 4: Full regression and local execution verification

**Files:**
- Modify: `data/novatest.db` only through automatic migration at local service startup; do not stage it.

- [ ] **Step 1: Run the full suite**

Run: `npm test`  
Expected: exit code 0 with all tests passing.

- [ ] **Step 2: Start the local service and create a multi-step batch**

Run: `npm start`  
Expected: `http://127.0.0.1:4173` responds to `/api/health`.

Use two existing safe API cases with a different combined number of steps. Open execution center while the batch is running and confirm the list and detail retain the original total cases/steps throughout polling. On completion, confirm the report button is in the conclusion header and the batch report presents status groups in the documented order.

- [ ] **Step 3: Commit only scoped files**

```bash
git add server/services/execution-service.js server/services/batch-service.js server/app.js server/storage/sqlite-store.js server/storage/file-store.js server/services/report-service.js app.js style.css tests/execution-service.test.js tests/sqlite-store.test.js tests/app.test.js tests/styles.test.js docs/superpowers/plans/2026-08-13-execution-report-grouping-and-planned-totals.md
git commit -m "feat: group execution reports and fix task totals"
```
