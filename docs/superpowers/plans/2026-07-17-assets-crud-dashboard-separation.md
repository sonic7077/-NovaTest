# Assets CRUD and Dashboard Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Web UI test-case CRUD into a dedicated test-assets route while leaving the dashboard focused on execution and quality data, without losing deleted-case history.

**Architecture:** Migrate SQLite history relations so runs store a case-name snapshot and run/batch links survive physical case deletion. Extend the existing Store and Express API with query/update/delete operations, then replace the single mixed screen with hash-routed dashboard, assets-list, and asset-editor views.

**Tech Stack:** Node.js 22 `node:sqlite`, Express 5, Vitest, Supertest, browser JavaScript, CSS.

## Global Constraints

- Use hash routes `#/dashboard`, `#/assets`, `#/assets/new`, and `#/assets/:id`; do not add a frontend framework.
- Keep Midscene execution, serial batches, existing report URLs, and Store method return shapes compatible.
- Delete a case definition and its authored steps, but retain batch case IDs, runs, reports, logs, screenshots, and name snapshots.
- Add `test_runs.case_name` and remove the foreign-key dependency from `test_runs.case_id` and `batch_cases.case_id` during an idempotent SQLite schema migration.
- Do not add permissions, case versioning, tags, bulk deletion, or API test assets.
- Use `apply_patch`; write and observe failing tests before production code.

---

## File Structure

- `server/storage/sqlite-store.js`: schema version migration, active case query/update/delete, and case-name run snapshot persistence.
- `server/app.js`: CRUD endpoints, `q` filtering, and deleted-case-safe report route.
- `server/services/report-service.js`: report title accepts a case name rather than a live case object.
- `tests/sqlite-store.test.js`: schema migration, delete preservation, search and snapshots.
- `tests/app.test.js`: REST CRUD, deleted execution rejection, and retained reports.
- `index.html`, `app.js`, `style.css`: hash-router layout and separate dashboard/assets/editor views.
- `tests/styles.test.js`: CSS and route view regression checks.

### Task 1: SQLite history migration and case CRUD Store methods

**Files:**
- Modify: `server/storage/sqlite-store.js`
- Modify: `tests/sqlite-store.test.js`

**Interfaces:**
- Produces `getCase(id)`, `listCases(query = '')`, `saveCase(testCase)`, and `deleteCase(id)` for active definitions.
- `getRun(id)` adds `caseName`; batches retain `caseIds` after case deletion.

- [ ] **Step 1: Write failing SQLite tests**

```js
it('migrates legacy run and batch links before allowing case deletion', () => {
  const store = createSqliteStore({ databasePath: legacyDatabasePath });
  expect(store.getRun('run-1')).toMatchObject({ caseName: '结算验证' });
  expect(store.deleteCase('case-1')).toBe(true);
  expect(store.getCase('case-1')).toBeUndefined();
  expect(store.getBatch('batch-1').caseIds).toEqual(['case-1']);
  expect(store.getRun('run-1')).toMatchObject({ caseId: 'case-1', caseName: '结算验证' });
});

it('filters active cases by name and replaces an existing case', () => {
  const store = createSqliteStore({ databasePath });
  store.saveCase(webCase);
  store.saveCase({ ...webCase, id: 'case-2', name: '登录验证' });
  expect(store.listCases('结算').map((testCase) => testCase.id)).toEqual(['case-1']);
  expect(store.saveCase({ ...webCase, name: '结算验证 v2' })).toMatchObject({ name: '结算验证 v2' });
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- tests/sqlite-store.test.js`

Expected: FAIL because `caseName`, `deleteCase`, query filtering, and the schema migration do not exist.

- [ ] **Step 3: Implement idempotent migration and Store methods**

```js
function migrateHistorySchema() {
  if (db.prepare('PRAGMA user_version').get().user_version >= 2) return;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    inTransaction(() => {
      db.exec(`CREATE TABLE test_runs_next (
        id TEXT PRIMARY KEY, case_id TEXT NOT NULL, case_name TEXT NOT NULL,
        batch_id TEXT REFERENCES test_batches(id), batch_position INTEGER,
        status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
        variables_json TEXT NOT NULL
      );
      INSERT INTO test_runs_next (id, case_id, case_name, batch_id, batch_position, status, started_at, finished_at, variables_json)
      SELECT runs.id, runs.case_id, COALESCE(cases.name, '已删除用例'), runs.batch_id,
        runs.batch_position, runs.status, runs.started_at, runs.finished_at, runs.variables_json
      FROM test_runs AS runs LEFT JOIN test_cases AS cases ON cases.id = runs.case_id;
      CREATE TABLE batch_cases_next (
        batch_id TEXT NOT NULL REFERENCES test_batches(id) ON DELETE CASCADE,
        case_id TEXT NOT NULL, position INTEGER NOT NULL,
        PRIMARY KEY (batch_id, case_id), UNIQUE (batch_id, position)
      );
      INSERT INTO batch_cases_next (batch_id, case_id, position)
      SELECT batch_id, case_id, position FROM batch_cases;
      CREATE TABLE run_steps_next (
        run_id TEXT NOT NULL REFERENCES test_runs_next(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL, position INTEGER NOT NULL, status TEXT NOT NULL,
        attempts INTEGER NOT NULL, error TEXT, screenshot TEXT, logs_json TEXT NOT NULL,
        PRIMARY KEY (run_id, step_id), UNIQUE (run_id, position)
      );
      INSERT INTO run_steps_next (run_id, step_id, position, status, attempts, error, screenshot, logs_json)
      SELECT run_id, step_id, position, status, attempts, error, screenshot, logs_json FROM run_steps;
      DROP TABLE run_steps; DROP TABLE test_runs; DROP TABLE batch_cases;
      ALTER TABLE test_runs_next RENAME TO test_runs;
      ALTER TABLE batch_cases_next RENAME TO batch_cases;
      ALTER TABLE run_steps_next RENAME TO run_steps;
      PRAGMA user_version = 2;`);
    });
  } finally { db.exec('PRAGMA foreign_keys = ON'); }
}
```

Call migration after base schema creation. Write `case_name` from `run.caseName || getCase(run.caseId)?.name || '已删除用例'`; hydrate it as `caseName`. Add `deleteCase(id)` as a transaction deleting only `test_cases` (its steps cascade) and returning whether a row changed. `listCases(query)` uses a parameterized `LOWER(name) LIKE LOWER(?)` clause only when the trimmed query is nonempty.

- [ ] **Step 4: Run focused Store tests and verify they pass**

Run: `npm test -- tests/sqlite-store.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add server/storage/sqlite-store.js tests/sqlite-store.test.js && git commit -m "feat: support persistent case CRUD history"`

Expected: one commit with schema migration and Store CRUD behavior.

### Task 2: Case CRUD API and deleted-report compatibility

**Files:**
- Modify: `server/app.js`
- Modify: `server/services/report-service.js`
- Modify: `tests/app.test.js`

**Interfaces:**
- `GET /api/cases?q=`, `GET /api/cases/:id`, `PUT /api/cases/:id`, `DELETE /api/cases/:id`.
- `renderReport(run, caseName)` renders a retained run without looking up a live case.

- [ ] **Step 1: Write failing API tests**

```js
it('updates, searches, and deletes a test case', async () => {
  const created = (await request(app).post('/api/cases').send(webCase).expect(201)).body;
  await request(app).put(`/api/cases/${created.id}`).send({ ...webCase, name: '首页验证 v2' }).expect(200);
  await request(app).get('/api/cases?q=v2').expect(200).expect(({ body }) => expect(body).toMatchObject([{ id: created.id, name: '首页验证 v2' }]));
  await request(app).delete(`/api/cases/${created.id}`).expect(204);
  await request(app).get(`/api/cases/${created.id}`).expect(404);
  await request(app).post(`/api/cases/${created.id}/runs`).expect(404);
});

it('keeps a report accessible after its case definition is deleted', async () => {
  const created = (await request(app).post('/api/cases').send(webCase).expect(201)).body;
  const run = await request(app).post(`/api/cases/${created.id}/runs`).expect(202);
  await request(app).delete(`/api/cases/${created.id}`).expect(204);
  await request(app).get(`/api/runs/${run.body.id}/report`).expect(200).expect((response) => expect(response.text).toContain('首页验证'));
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- tests/app.test.js`

Expected: FAIL because update, delete, detail, query filtering, and report snapshots are unavailable.

- [ ] **Step 3: Implement endpoints and report rendering**

```js
app.get('/api/cases/:id', (req, res) => {
  const testCase = store.getCase(req.params.id);
  return testCase ? res.json(testCase) : res.status(404).json({ error: 'test case not found' });
});
app.put('/api/cases/:id', (req, res) => {
  if (!store.getCase(req.params.id)) return res.status(404).json({ error: 'test case not found' });
  try { return res.json(store.saveCase({ ...validateWebCase(req.body), id: req.params.id })); }
  catch (error) { return res.status(400).json({ error: error.message }); }
});
app.delete('/api/cases/:id', (req, res) => store.deleteCase(req.params.id) ? res.status(204).end() : res.status(404).json({ error: 'test case not found' }));
```

Pass `req.query.q || ''` into `store.listCases`. In the report route require only `run`; call `renderReport(run, run.caseName || '已删除用例')`. Update the memory Store to keep `caseName` on `saveRun`, accept a query filter, and implement `deleteCase`.

- [ ] **Step 4: Run API and report tests and verify they pass**

Run: `npm test -- tests/app.test.js tests/sqlite-store.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add server/app.js server/services/report-service.js tests/app.test.js && git commit -m "feat: expose test asset CRUD API"`

Expected: one commit with CRUD routes and retained report behavior.

### Task 3: Hash-routed dashboard and test-assets views

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`
- Modify: `tests/styles.test.js`

**Interfaces:**
- `renderRoute()` renders one of `dashboard`, `assets-list`, `asset-editor` using `location.hash`.
- Assets list loads `/api/cases?q=`; editor loads `GET /api/cases/:id`, saves with POST or PUT, and deletes with DELETE.

- [ ] **Step 1: Write failing static UI regression checks**

```js
expect(html).toContain('#/dashboard');
expect(html).toContain('#/assets');
expect(stylesheet).toContain('.assets-table');
expect(stylesheet).toContain('.route-view');
expect(script).toContain('function renderRoute()');
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL because route views and asset-table styles are absent.

- [ ] **Step 3: Implement separate views and client behavior**

```js
function renderRoute() {
  const path = location.hash || '#/dashboard';
  document.querySelectorAll('.route-view').forEach((view) => { view.hidden = view.dataset.route !== path; });
  if (path === '#/assets') loadAssets();
  if (path.startsWith('#/assets/') && path !== '#/assets/new') loadEditor(path.slice('#/assets/'.length));
  if (path === '#/dashboard') loadDashboard();
}
window.addEventListener('hashchange', renderRoute);
```

Place execution status, recent reports, batch history, and metrics in the dashboard view only. Place table search, create/edit/delete commands, selection, and batch execution in the assets view only. Reuse the existing step editor inside the asset-editor view. Use a native confirmation dialog for deletion, disable the command while the DELETE request is in flight, and navigate to `#/assets` on success. Use DOM `textContent` for all case names returned by the API.

- [ ] **Step 4: Run static UI regression test and verify it passes**

Run: `npm test -- tests/styles.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add index.html app.js style.css tests/styles.test.js && git commit -m "feat: separate assets CRUD from dashboard"`

Expected: one commit with hash routes and separated views.

### Task 4: Full validation and browser workflow

**Files:**
- Verify only: all files above

- [ ] **Step 1: Run complete automated suite**

Run: `npm test`

Expected: PASS with zero failures.

- [ ] **Step 2: Run production server and verify desktop flow**

Run: `PORT=4181 npm start`

Verify `#/dashboard` has no editor; navigate to `#/assets`, create a case, edit it, search it, delete it, and open its retained report from batch history.

- [ ] **Step 3: Verify H5 route layout**

At `390x844`, verify navigation to dashboard/assets/new-editor has no horizontal overflow and all command text fits its button.

- [ ] **Step 4: Inspect final working tree**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and no data files staged.
