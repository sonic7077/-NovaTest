# Project Batch History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict the recent batch history in a project's test asset view to batches that belong to that project.

**Architecture:** Persist `projectId` directly on each batch when the server creates it from same-project cases. Migrate legacy batches to `默认项目`, expose optional filtering from the batch collection endpoint, and send the active project ID from the project asset page.

**Tech Stack:** Node.js, Express, `node:sqlite`, native ES modules, Vitest, Supertest.

## Global Constraints

- A batch's project ID is immutable after creation, including when its cases move or are deleted.
- Legacy batches with no project ID belong to `默认项目`.
- `GET /api/batches` without `projectId` keeps global history behavior.
- Do not commit `.env`, `data/`, `evidence/`, `.DS_Store`, tokens, API keys, or credentials.

---

### Task 1: Persist and migrate batch project ownership

**Files:**
- Modify: `server/storage/sqlite-store.js:18-455`
- Modify: `server/storage/file-store.js:1-90`
- Modify: `server/app.js:11-52`
- Modify: `server/services/batch-service.js:8-39`
- Modify: `tests/sqlite-store.test.js:90-290`
- Modify: `tests/file-store.test.js:1-90`
- Modify: `tests/batch-service.test.js:1-110`

**Interfaces:**
- Produces: batch objects shaped as `{ id, projectId, name, caseIds, status, runIds, startedAt, finishedAt }`.
- Produces: `listBatches(projectId = '')` on all stores.
- Consumes: resolved same-project `cases` passed by the batch API.

- [ ] **Step 1: Write failing persistence tests**

Add a SQLite test that saves two batches with different project IDs and expects `listBatches(firstProjectId)` to return only the first batch after reopening the store. Add a legacy schema fixture with a `test_batches` table without `project_id`, then assert its batch becomes a member of `默认项目`. Add file-store and memory/batch-service assertions that `projectId` is retained.

```js
expect(reloaded.getBatch('batch-1')).toMatchObject({ projectId: defaultProject.id });
expect(reloaded.listBatches(projectA.id).map((batch) => batch.id)).toEqual(['batch-a']);
```

- [ ] **Step 2: Run storage and service tests to confirm failure**

Run: `npm test -- tests/sqlite-store.test.js tests/file-store.test.js tests/batch-service.test.js`

Expected: FAIL because batches have no project ID and `listBatches` ignores the filter.

- [ ] **Step 3: Implement the durable batch property**

Add an idempotent `project_id` migration to `test_batches`; reuse `defaultProject()` to backfill legacy values and add a project index. Select/write `project_id AS projectId` in SQLite batch hydration and persistence. Mirror `projectId` retention and optional filtering in the file and memory stores.

Change `BatchService.start` to require `projectId` and place it on its batch object. Pass `cases[0].projectId` from `POST /api/batches` after the same-project guard.

- [ ] **Step 4: Run storage and service tests to confirm success**

Run: `npm test -- tests/sqlite-store.test.js tests/file-store.test.js tests/batch-service.test.js`

Expected: PASS, including existing batch ordering, legacy migration, and CMS session reuse tests.

- [ ] **Step 5: Commit persistence work**

```bash
git add server/storage/sqlite-store.js server/storage/file-store.js server/app.js server/services/batch-service.js tests/sqlite-store.test.js tests/file-store.test.js tests/batch-service.test.js
git commit -m "feat: scope batch history by project"
```

### Task 2: Expose filtered batch history and update the project view

**Files:**
- Modify: `server/app.js:142-148`
- Modify: `app.js:411-420`
- Modify: `tests/app.test.js:120-150`
- Modify: `tests/styles.test.js:1-70`

**Interfaces:**
- Consumes: `store.listBatches(projectId)` from Task 1 and `activeProjectId` from the asset route.
- Produces: `GET /api/batches?projectId=<id>` and `loadBatchHistory(projectId = activeProjectId)`.

- [ ] **Step 1: Write failing API and frontend regression tests**

Create two projects and one batch in each. Assert the batch collection endpoint returns both without a parameter and only the matching batch with `?projectId=`. Add a static frontend assertion for `fetch(`/api/batches?projectId=${encodeURIComponent(activeProjectId)}`)`.

```js
await request(app).get(`/api/batches?projectId=${project.id}`).expect(200)
  .expect(({ body }) => expect(body.map((batch) => batch.projectId)).toEqual([project.id]));
```

- [ ] **Step 2: Run targeted tests to confirm failure**

Run: `npm test -- tests/app.test.js tests/styles.test.js`

Expected: FAIL because the collection endpoint and frontend request do not use project ID.

- [ ] **Step 3: Implement collection filtering and project view request**

Make `GET /api/batches` pass `req.query.projectId || ''` to the store before reversing its result. Change `loadBatchHistory` to accept `projectId = activeProjectId`; fetch with an encoded `projectId` only when supplied. Keep the post-run call global-safe by passing the saved case's project ID when the caller is on an asset page.

- [ ] **Step 4: Run targeted and full regression tests**

Run: `npm test -- tests/app.test.js tests/styles.test.js && npm test && node --check app.js && git diff --check`

Expected: all commands exit 0; global history tests still pass without a filter.

- [ ] **Step 5: Browser acceptance and commit**

Open an empty project and verify its recent-batch section is empty. Open `默认项目` and verify migrated legacy batches appear. Create or run a batch in a non-default project and verify it appears only there. Commit:

```bash
git add server/app.js app.js tests/app.test.js tests/styles.test.js
git commit -m "feat: filter project batch history"
```
