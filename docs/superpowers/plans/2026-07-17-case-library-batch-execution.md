# Test Case Library and Serial Batch Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable saved Web UI cases to be selected, executed serially as a persistent batch, and reviewed through batch history and linked reports.

**Architecture:** Add a focused `BatchService` that delegates each selected case to the existing `RunService` in order and persists every run before continuing. Extend both store implementations with batch records, expose batch REST endpoints from the existing Express application, then make the existing case-library panel select cases and display batch history.

**Tech Stack:** Node.js ESM, Express 5, Vitest, Supertest, browser JavaScript, CSS, Playwright/Midscene through the existing runner.

## Global Constraints

- Scope is Web UI only; do not change Midscene, Playwright, or model configuration behavior.
- Execute selected cases strictly in selected order, one at a time.
- A failed case records a failed run and does not stop later cases.
- A batch passes only when every linked run passes; otherwise it fails.
- Reject empty, duplicate, or unknown `caseIds` with HTTP 400 without saving a batch.
- Persist batches alongside cases and runs in `data/store.json`.
- Use `apply_patch` for file edits and write tests before production behavior.

---

## File Structure

- `server/services/batch-service.js`: validates a prepared selection at service boundary, creates status transitions, invokes `RunService` serially, and persists runs/batch progress.
- `server/storage/file-store.js`: adds `batches` to file-backed data and batch read/write methods.
- `server/app.js`: adds in-memory batch methods, constructs `BatchService`, and exposes batch endpoints.
- `tests/batch-service.test.js`: covers serial order, continuation after a failure, and final status.
- `tests/file-store.test.js`: proves batches survive a store reload.
- `tests/app.test.js`: covers batch creation, validation, listing, and detail retrieval.
- `index.html`, `app.js`, `style.css`: selection controls, batch submission state, and batch history/report links.

### Task 1: Batch persistence contracts

**Files:**
- Modify: `server/storage/file-store.js`
- Modify: `server/app.js`
- Modify: `tests/file-store.test.js`

**Interfaces:**
- Produces: `saveBatch(batch)`, `getBatch(id)`, and `listBatches()` on both stores.
- Batch object: `{ id, name, caseIds, status, runIds, startedAt, finishedAt }`.

- [ ] **Step 1: Write the failing persistence tests**

```js
it('persists batches across store reloads', async () => {
  const store = createFileStore(filePath);
  const batch = store.saveBatch({ id: 'batch-1', name: '冒烟回归', caseIds: ['case-1'], status: 'queued', runIds: [], startedAt: null, finishedAt: null });
  expect(createFileStore(filePath).getBatch(batch.id)).toEqual(batch);
  expect(createFileStore(filePath).listBatches()).toEqual([batch]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/file-store.test.js`

Expected: FAIL because `saveBatch` is not defined.

- [ ] **Step 3: Add the minimal store methods**

```js
function emptyData() { return { cases: {}, runs: {}, batches: {} }; }

saveBatch(batch) { const data = load(); data.batches[batch.id] = batch; save(data); return batch; }
getBatch(id) { return load().batches[id]; }
listBatches() { return Object.values(load().batches); }
```

Add equivalent `Map`-backed methods to `createMemoryStore()`.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- tests/file-store.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/storage/file-store.js server/app.js tests/file-store.test.js
git commit -m "feat: persist batch records"
```

### Task 2: Serial batch orchestration

**Files:**
- Create: `server/services/batch-service.js`
- Create: `tests/batch-service.test.js`

**Interfaces:**
- Consumes: a store with `saveRun(run)` and `saveBatch(batch)`, and `new RunService(runner)`.
- Produces: `new BatchService({ runner, store }).start({ name, caseIds, cases })` returning the finished batch.

- [ ] **Step 1: Write failing serial-execution tests**

```js
it('runs cases in order and continues after a failed run', async () => {
  const called = [];
  const runner = { execute: async (_step, context) => { called.push(context.testCase.id); if (context.testCase.id === 'case-1') throw new Error('missing'); return {}; } };
  const batch = await new BatchService({ runner, store }).start({ name: '回归', caseIds: ['case-1', 'case-2'], cases: [firstCase, secondCase] });
  expect(called).toEqual(['case-1', 'case-1', 'case-2']);
  expect(batch).toMatchObject({ status: 'failed', caseIds: ['case-1', 'case-2'] });
  expect(batch.runIds).toHaveLength(2);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/batch-service.test.js`

Expected: FAIL because `BatchService` does not exist.

- [ ] **Step 3: Implement the smallest serial service**

```js
const batch = { id: crypto.randomUUID(), name, caseIds, status: 'running', runIds: [], startedAt: new Date().toISOString(), finishedAt: null };
store.saveBatch(batch);
for (const testCase of cases) {
  const run = await runService.start(testCase);
  store.saveRun(run);
  batch.runIds.push(run.id);
  store.saveBatch(batch);
}
batch.status = batch.runIds.every((id) => store.getRun(id).status === 'passed') ? 'passed' : 'failed';
batch.finishedAt = new Date().toISOString();
return store.saveBatch(batch);
```

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `npm test -- tests/batch-service.test.js tests/run-service.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/batch-service.js tests/batch-service.test.js
git commit -m "feat: run test batches serially"
```

### Task 3: Batch API

**Files:**
- Modify: `server/app.js`
- Modify: `tests/app.test.js`

**Interfaces:**
- `POST /api/batches` receives `{ name?: string, caseIds: string[] }`, returns the completed batch with HTTP 202.
- `GET /api/batches` returns newest saved batches first.
- `GET /api/batches/:id` returns `{ ...batch, runs }`.

- [ ] **Step 1: Write failing API tests**

```js
it('creates, lists, and retrieves a serial batch with linked runs', async () => {
  const first = (await request(app).post('/api/cases').send(webCase)).body;
  const second = (await request(app).post('/api/cases').send({ ...webCase, name: '详情验证' })).body;
  const batch = await request(app).post('/api/batches').send({ name: '冒烟', caseIds: [first.id, second.id] }).expect(202);
  expect(batch.body.runIds).toHaveLength(2);
  await request(app).get('/api/batches').expect(200).expect(({ body }) => expect(body[0].id).toBe(batch.body.id));
  await request(app).get(`/api/batches/${batch.body.id}`).expect(200).expect(({ body }) => expect(body.runs).toHaveLength(2));
});

it.each([[], ['missing'], ['same', 'same']])('rejects invalid batch selections', async (caseIds) => {
  await request(app).post('/api/batches').send({ caseIds }).expect(400);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/app.test.js`

Expected: FAIL because `/api/batches` is not registered.

- [ ] **Step 3: Implement validation and routes**

```js
app.post('/api/batches', async (req, res) => {
  const caseIds = req.body.caseIds;
  if (!Array.isArray(caseIds) || caseIds.length === 0 || new Set(caseIds).size !== caseIds.length) return res.status(400).json({ error: 'select unique test cases' });
  const cases = caseIds.map((id) => store.getCase(id));
  if (cases.some((testCase) => !testCase)) return res.status(400).json({ error: 'test case not found' });
  return res.status(202).json(await batchService.start({ name: req.body.name || `批量执行 ${new Date().toLocaleString('zh-CN')}`, caseIds, cases }));
});
```

Implement list and detail routes, returning 404 for an unknown batch.

- [ ] **Step 4: Run API tests and verify they pass**

Run: `npm test -- tests/app.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app.js tests/app.test.js
git commit -m "feat: expose batch execution API"
```

### Task 4: Case selection and batch history console

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`
- Modify: `tests/styles.test.js`

**Interfaces:**
- `loadSavedCases()` renders one checkbox per saved case and keeps `selectedCaseIds` in list order.
- `POST /api/batches` is invoked with the selected IDs; the action is disabled while it is in flight.
- `loadBatches()` reads `/api/batches` and renders total status, pass/fail counts, timestamps, and report links.

- [ ] **Step 1: Write the failing stylesheet regression expectations**

```js
expect(css).toContain('.asset-selection');
expect(css).toContain('.batch-history');
expect(ruleCount).toBeGreaterThan(140);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL because batch selectors are absent.

- [ ] **Step 3: Add semantic controls and client behavior**

Add an asset-toolbar with selected count and `#runBatch`, place `#batchHistory` below the case list, render controls with DOM APIs (not untrusted HTML for case names), and implement:

```js
async function createBatch() {
  const response = await fetch('/api/batches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseIds: selectedCaseIds() }) });
  if (!response.ok) throw new Error((await response.json()).error || '批量执行失败');
  await loadBatches();
}
```

Use `disabled` state to prevent repeated submit; add responsive styles for toolbar, checkbox list items, and history rows.

- [ ] **Step 4: Run the focused UI regression test**

Run: `npm test -- tests/styles.test.js`

Expected: PASS.

- [ ] **Step 5: Browser and API verification**

Run: `npm test`

Start: `npm start`

Verify at desktop and `390x844`: saved cases can be selected, selection count changes, invalid empty execution is unavailable, a batch renders its result, and report links point to `/api/runs/:id/report`.

- [ ] **Step 6: Commit**

```bash
git add index.html app.js style.css tests/styles.test.js
git commit -m "feat: add batch controls to test library"
```

### Task 5: Final regression verification

**Files:**
- Verify only: all files above

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: PASS with zero failed tests.

- [ ] **Step 2: Inspect the change set**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and only intended changes.

- [ ] **Step 3: Commit only an actual final verification fix**

If the two checks above introduce no source changes, do not create an empty commit. If a verification fix is required, stage its exact changed paths and commit it with `test: fix batch execution regression`.
