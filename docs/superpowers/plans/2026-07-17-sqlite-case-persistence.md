# SQLite Case Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Web UI test cases, ordered steps, batches, and execution history in SQLite while preserving the current Store and HTTP API contracts.

**Architecture:** `server/storage/sqlite-store.js` uses Node 22 `node:sqlite` to store normalized records and reconstruct the nested Store responses. On first production start it imports the JSON file in a transaction, then production switches from the JSON file Store to SQLite without changing services or endpoints.

**Tech Stack:** Node.js 22.15 `node:sqlite`, Express 5, Vitest, Supertest.

## Global Constraints

- Use `data/novatest.db`; do not add a third-party database dependency.
- Preserve `saveCase`, `getCase`, `listCases`, `saveRun`, `getRun`, `saveBatch`, `getBatch`, and `listBatches` return shapes.
- Do not modify Web UI/Midscene, HTTP APIs, `RunService`, or `BatchService`.
- Normalize cases, steps, batches, batch items, runs, and run steps; serialize only variables and logs as JSON text.
- Enable foreign keys, use prepared SQL, and use transactions for aggregate writes and migration.
- Migrate `data/store.json` only into an empty database; after success rename it to `data/store.json.migrated` without overwriting an existing backup.
- Use `apply_patch` and write tests before their production behavior.

---

## File Structure

- `server/storage/sqlite-store.js`: schema, nested object hydration, persistence, and one-time JSON migration.
- `server/index.js`: creates the production SQLite Store.
- `tests/sqlite-store.test.js`: persistence, aggregate replacement, ordered links, and migration tests with temporary files.
- `tests/production-entry.test.js`: production entrypoint regression test.
- `package.json`: explicit Node floor for `node:sqlite`.

### Task 1: Schema and case persistence

**Files:**
- Create: `server/storage/sqlite-store.js`
- Create: `tests/sqlite-store.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces `createSqliteStore({ databasePath, legacyJsonPath? })`.
- `saveCase(testCase)` returns a case with `id`; reads return ordered `steps`.

- [ ] **Step 1: Write the failing case tests**

```js
it('persists a case with steps in position order across store instances', () => {
  createSqliteStore({ databasePath }).saveCase({ ...webCase, steps: [webCase.steps[1], webCase.steps[0]] });
  const loaded = createSqliteStore({ databasePath }).getCase(webCase.id);
  expect(loaded).toMatchObject({ id: webCase.id, name: '结算验证' });
  expect(loaded.steps.map((step) => step.id)).toEqual(['step-2', 'step-1']);
});

it('atomically replaces obsolete steps when resaving a case', () => {
  const store = createSqliteStore({ databasePath });
  store.saveCase(webCase);
  store.saveCase({ ...webCase, steps: [webCase.steps[1]] });
  expect(store.getCase(webCase.id).steps).toEqual([webCase.steps[1]]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/sqlite-store.test.js`

Expected: FAIL because `sqlite-store.js` does not exist.

- [ ] **Step 3: Implement the minimal schema and methods**

```js
import { DatabaseSync } from 'node:sqlite';

const schema = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS test_cases (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, target TEXT NOT NULL,
    base_url TEXT NOT NULL, viewport TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS test_steps (
    id TEXT NOT NULL, case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, kind TEXT NOT NULL, instruction TEXT NOT NULL,
    PRIMARY KEY (case_id, id), UNIQUE (case_id, position)
  );`;
```

Open `DatabaseSync(databasePath)`, execute `schema`, and implement `inTransaction(work)` with `BEGIN`, `COMMIT`, and `ROLLBACK`. Implement a private `writeCase(testCase)` that upserts `test_cases`, deletes its steps, then inserts each input step with its array index as `position`. Expose `saveCase(testCase) { return inTransaction(() => writeCase(testCase)); }`. Hydrate `getCase` and `listCases` using `ORDER BY position`. Add `"engines": { "node": ">=22.15.0" }` to `package.json`.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `npm test -- tests/sqlite-store.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add package.json server/storage/sqlite-store.js tests/sqlite-store.test.js && git commit -m "feat: persist test cases in sqlite"`

Expected: one commit containing schema and case persistence.

### Task 2: Run and batch persistence

**Files:**
- Modify: `server/storage/sqlite-store.js`
- Modify: `tests/sqlite-store.test.js`

**Interfaces:**
- `saveRun`/`getRun` preserve `variables`, ordered step outcomes, logs, errors, and screenshots.
- `saveBatch`/`getBatch` preserve ordered `caseIds`, ordered `runIds`, and summary status.

- [ ] **Step 1: Write the failing run/batch persistence test**

```js
it('persists run evidence and ordered batch links across instances', () => {
  const store = createSqliteStore({ databasePath });
  store.saveCase(webCase);
  store.saveRun({ id: 'run-1', caseId: webCase.id, status: 'failed', startedAt: '2026-07-17T00:00:00.000Z', finishedAt: '2026-07-17T00:01:00.000Z', variables: { orderId: 'A-1' }, steps: [{ id: 'step-1', status: 'failed', attempts: 2, error: 'missing', screenshot: 'evidence/a.png', logs: [{ level: 'warn', message: 'retrying' }] }] });
  store.saveBatch({ id: 'batch-1', name: '回归', caseIds: [webCase.id], status: 'failed', runIds: ['run-1'], startedAt: '2026-07-17T00:00:00.000Z', finishedAt: '2026-07-17T00:01:00.000Z' });
  const reloaded = createSqliteStore({ databasePath });
  expect(reloaded.getRun('run-1')).toMatchObject({ variables: { orderId: 'A-1' }, steps: [{ screenshot: 'evidence/a.png', logs: [{ message: 'retrying' }] }] });
  expect(reloaded.getBatch('batch-1')).toMatchObject({ caseIds: [webCase.id], runIds: ['run-1'] });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/sqlite-store.test.js`

Expected: FAIL because the Store lacks run and batch persistence.

- [ ] **Step 3: Add tables and aggregate writes**

```sql
CREATE TABLE IF NOT EXISTS test_batches (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS batch_cases (batch_id TEXT NOT NULL REFERENCES test_batches(id) ON DELETE CASCADE, case_id TEXT NOT NULL REFERENCES test_cases(id), position INTEGER NOT NULL, PRIMARY KEY (batch_id, case_id), UNIQUE (batch_id, position));
CREATE TABLE IF NOT EXISTS test_runs (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES test_cases(id), batch_id TEXT REFERENCES test_batches(id), batch_position INTEGER, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, variables_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS run_steps (run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE, step_id TEXT NOT NULL, position INTEGER NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL, error TEXT, screenshot TEXT, logs_json TEXT NOT NULL, PRIMARY KEY (run_id, step_id), UNIQUE (run_id, position));
```

Implement private `writeRun` and `writeBatch` functions for parent upsert, child deletion and ordered insertions; each public Store method wraps its own writer in `inTransaction`. Store JSON as `JSON.stringify(value ?? {})` or `JSON.stringify(value ?? [])`; parse it when hydrating. `writeBatch` assigns each linked run its `batch_position`, and `getBatch` reads `batch_cases ORDER BY position` plus runs ordered by `batch_position, started_at, id`. `listBatches` returns ascending `created_at` so the existing API `.reverse()` remains newest-first.

- [ ] **Step 4: Run Store and service tests and verify they pass**

Run: `npm test -- tests/sqlite-store.test.js tests/run-service.test.js tests/batch-service.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add server/storage/sqlite-store.js tests/sqlite-store.test.js && git commit -m "feat: persist runs and batches in sqlite"`

Expected: one commit containing normalized run and batch persistence.

### Task 3: JSON migration and production activation

**Files:**
- Modify: `server/storage/sqlite-store.js`
- Modify: `server/index.js`
- Create: `tests/production-entry.test.js`
- Modify: `tests/sqlite-store.test.js`

**Interfaces:**
- JSON is imported only if `test_cases` is empty, then moved to `${legacyJsonPath}.migrated` when no backup exists.
- Production creates `createSqliteStore({ databasePath: 'data/novatest.db', legacyJsonPath: 'data/store.json' })`.

- [ ] **Step 1: Write the failing migration and entry tests**

```js
it('migrates JSON once and saves a migrated backup', async () => {
  await writeFile(legacyJsonPath, JSON.stringify({ cases: { [webCase.id]: webCase }, runs: {}, batches: {} }));
  const store = createSqliteStore({ databasePath, legacyJsonPath });
  expect(store.getCase(webCase.id)).toMatchObject({ name: '结算验证', steps: webCase.steps });
  await expect(readFile(`${legacyJsonPath}.migrated`, 'utf8')).resolves.toContain('结算验证');
  expect(existsSync(legacyJsonPath)).toBe(false);
});

it('keeps malformed legacy JSON and imports no partial records', async () => {
  await writeFile(legacyJsonPath, '{invalid');
  expect(() => createSqliteStore({ databasePath, legacyJsonPath })).toThrow();
  expect(existsSync(legacyJsonPath)).toBe(true);
});
```

Create `tests/production-entry.test.js` with:

```js
it('uses the SQLite Store in production', async () => {
  const source = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');
  expect(source).toContain("createSqliteStore({ databasePath: 'data/novatest.db', legacyJsonPath: 'data/store.json' })");
  expect(source).not.toContain("createFileStore('data/store.json')");
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- tests/sqlite-store.test.js tests/production-entry.test.js`

Expected: FAIL because migration and production wiring do not exist.

- [ ] **Step 3: Implement atomic migration and entry wiring**

```js
function migrateLegacyStore() {
  if (!legacyJsonPath || !existsSync(legacyJsonPath)) return;
  if (db.prepare('SELECT COUNT(*) AS count FROM test_cases').get().count > 0) return;
  const legacy = JSON.parse(readFileSync(legacyJsonPath, 'utf8'));
  const backupPath = `${legacyJsonPath}.migrated`;
  let renamed = false;
  try {
    inTransaction(() => {
      Object.values(legacy.cases ?? {}).forEach(writeCase);
      Object.values(legacy.runs ?? {}).forEach(writeRun);
      Object.values(legacy.batches ?? {}).forEach(writeBatch);
      if (!existsSync(backupPath)) { renameSync(legacyJsonPath, backupPath); renamed = true; }
    });
  } catch (error) {
    if (renamed && !existsSync(legacyJsonPath)) renameSync(backupPath, legacyJsonPath);
    throw error;
  }
}
```

Before saving each migrated batch, skip unknown case IDs. After saving it, link only known run IDs to the batch. Keep the source JSON if parsing, the transaction, rename, or database commit fails. In `server/index.js`, replace `createFileStore` with the exact SQLite construction in the interface section.

- [ ] **Step 4: Run migration, API, and full regression tests**

Run: `npm test`

Expected: PASS with zero failed tests.

- [ ] **Step 5: Commit**

Run: `git add server/index.js server/storage/sqlite-store.js tests/sqlite-store.test.js tests/production-entry.test.js && git commit -m "feat: migrate test assets to sqlite"`

Expected: one commit activating production SQLite persistence.

### Task 4: Manual restart verification

**Files:**
- Verify only: `server/index.js`, `data/novatest.db`, and the local test console

- [ ] **Step 1: Start the production service**

Run: `PORT=4179 npm start`

Expected: server starts on `127.0.0.1:4179` and initializes SQLite.

- [ ] **Step 2: Confirm persisted API records after restart**

Create two valid cases with `POST /api/cases`, create a batch with `POST /api/batches`, restart the service, then verify `GET /api/cases` preserves ordered steps and `GET /api/batches/:id` preserves `caseIds`, `runIds`, and report URLs.

- [ ] **Step 3: Inspect final changes**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and no database or JSON data file staged for commit.
