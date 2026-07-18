# Project Test Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable projects above Web UI and API test cases so assets are authored, listed, and batch-run in a project context.

**Architecture:** Add a project repository contract to every store and migrate SQLite test cases to a required `project_id`, using `默认项目` for legacy data. Express validates project ownership, then the hash-routed frontend separates the project directory from the selected project's case list and editor.

**Tech Stack:** Node.js, Express, `node:sqlite`, native ES modules, HTML/CSS, Vitest, Supertest.

## Global Constraints

- Existing cases migrate idempotently into exactly one `默认项目`; runs and reports remain accessible by their existing IDs.
- Both Web UI and API cases require a valid `projectId` on every create and update.
- Project deletion is allowed only when it has no cases; it never deletes cases, runs, batches, reports, credentials, or evidence.
- Batch execution accepts cases from exactly one project and rejects mixed-project requests server-side.
- Do not commit `.env`, `data/`, `evidence/`, `.DS_Store`, tokens, API keys, or credentials.

---

### Task 1: Add project persistence and legacy migration

**Files:**
- Modify: `server/storage/sqlite-store.js:1-360`
- Modify: `server/storage/file-store.js:1-120`
- Modify: `server/app.js:11-24`
- Modify: `tests/sqlite-store.test.js:1-290`
- Modify: `tests/file-store.test.js:1-160`

**Interfaces:**
- Produces: `listProjects()`, `getProject(id)`, `saveProject(project)`, `deleteProject(id)`, and `listCases(query, projectId)` on every store.
- Produces: test cases shaped as `{ id, projectId, name, target, baseUrl, viewport, steps }`.
- Consumes: existing `createSqliteStore({ databasePath, legacyJsonPath })` and existing `saveCase()` transactions.

- [ ] **Step 1: Write the failing SQLite migration and repository tests**

Add tests that initialize a database with an old `test_cases` layout and assert one project named `默认项目` exists, the old case returns a nonempty `projectId`, and a reopened store returns the same association. Add project CRUD assertions: trim a name, reject duplicate case-insensitive names, return project case totals, filter `listCases('', projectId)`, and return `false` when deleting a populated project.

```js
const store = createSqliteStore({ databasePath });
const [defaultProject] = store.listProjects();
expect(defaultProject).toMatchObject({ name: '默认项目', caseCount: 1 });
expect(store.getCase('legacy-case').projectId).toBe(defaultProject.id);
expect(store.listCases('', defaultProject.id)).toHaveLength(1);
expect(store.deleteProject(defaultProject.id)).toBe(false);
```

- [ ] **Step 2: Run the storage test to verify the new contract fails**

Run: `npm test -- tests/sqlite-store.test.js tests/file-store.test.js`

Expected: FAIL because project store methods and case `projectId` persistence do not yet exist.

- [ ] **Step 3: Implement the minimum project-aware store contract**

In `sqlite-store.js`, create `projects` before test-case access; add `project_id` through an idempotent column migration; create and use `默认项目` for null/empty legacy values; add the project index. Select and write `project_id AS projectId`; require it in `writeCase`. Implement project listing with Web/API counts, `getProject`, normalized/unique create-or-update behavior, and deletion that returns `false` when a matching case exists.

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS test_cases_project_id_idx ON test_cases(project_id);
```

Mirror these methods in `file-store.js` and `createMemoryStore()`. Their seeded/default project behavior must make existing test fixtures usable, while all newly saved cases retain `projectId`.

- [ ] **Step 4: Run storage tests to verify the implementation passes**

Run: `npm test -- tests/sqlite-store.test.js tests/file-store.test.js`

Expected: PASS, including existing persistence and legacy JSON migration coverage.

- [ ] **Step 5: Commit the storage migration**

```bash
git add server/storage/sqlite-store.js server/storage/file-store.js server/app.js tests/sqlite-store.test.js tests/file-store.test.js
git commit -m "feat: organize test cases by project"
```

### Task 2: Add project HTTP APIs and enforce ownership in execution

**Files:**
- Modify: `server/domain/case.js:1-31`
- Modify: `server/app.js:25-155`
- Modify: `tests/app.test.js:1-300`

**Interfaces:**
- Consumes: store project methods from Task 1 and `validateWebCase(input)`.
- Produces: `GET|POST /api/projects`, `PUT|DELETE /api/projects/:id`, and project-aware `GET /api/cases?projectId=&q=`.
- Produces: HTTP `400` for malformed/unknown project IDs and `409` for duplicate project names, nonempty deletion, and mixed-project batch selections.

- [ ] **Step 1: Write failing API contract tests**

Create two projects, create one Web case and one API case in different projects, then assert filtered list results. Assert create/update reject an unknown `projectId`; project deletion returns `409` while it owns a case; and a batch containing cases from the two projects returns `409` before calling a runner.

```js
await request(app).post('/api/batches').send({ caseIds: [web.id, api.id] })
  .expect(409)
  .expect(({ body }) => expect(body.error).toMatch(/同一项目/));
```

- [ ] **Step 2: Run the API test suite and verify failures**

Run: `npm test -- tests/app.test.js`

Expected: FAIL on missing project routes, missing `projectId` validation, or acceptance of a mixed batch.

- [ ] **Step 3: Implement the HTTP boundary**

Add project routes before dynamic `/api/cases/:id` routes. Normalize `{ name }`; map invalid/duplicate names to `400`/`409`; return `409` when `deleteProject()` reports a nonempty project. On case POST/PUT, validate the existing case payload then verify `store.getProject(projectId)` before saving. Pass `req.query.projectId` to `listCases`.

Before `batchService.start`, resolve all requested cases, compare `new Set(cases.map(({ projectId }) => projectId)).size`, and reject any value other than one with `{ error: '批量执行只能选择同一项目的用例' }` and HTTP 409.

- [ ] **Step 4: Run API tests to verify all route behavior**

Run: `npm test -- tests/app.test.js tests/batch-service.test.js`

Expected: PASS with no runner invocation for rejected cross-project batches.

- [ ] **Step 5: Commit the API contract**

```bash
git add server/app.js server/domain/case.js tests/app.test.js
git commit -m "feat: add project asset APIs"
```

### Task 3: Build project directory and project-context asset editing

**Files:**
- Modify: `index.html:72-131`
- Modify: `app.js:1-480`
- Modify: `style.css:78-245`
- Modify: `tests/styles.test.js:1-70`

**Interfaces:**
- Consumes: `/api/projects`, `/api/cases?projectId=`, and case `projectId` fields from Tasks 1-2.
- Produces: routes `#/assets`, `#/projects/:projectId/assets`, `#/projects/:projectId/assets/new-web`, `#/projects/:projectId/assets/new-api`, and `#/projects/:projectId/assets/:caseId`.
- Produces: `activeProjectId`, `loadProjects()`, and project-aware `saveCase()` / `createBatch()` behavior.

- [ ] **Step 1: Add static frontend regression expectations**

Extend `tests/styles.test.js` to require semantic project controls (`#projectList`, `#createProject`, `#caseProjectId`) and project-aware links/fetches in `app.js`.

```js
expect(html).toContain('id="projectList"');
expect(html).toContain('id="caseProjectId"');
expect(script).toContain('/api/projects');
expect(script).toContain('#/projects/');
```

- [ ] **Step 2: Run the static test and verify it fails**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL because project directory markup and project-aware routing are absent.

- [ ] **Step 3: Implement project directory markup and responsive styles**

Replace the current direct asset-library landing content with a project directory section containing an accessible project-name input, `#createProject` command, and `#projectList`. Keep the existing case table in a project detail section with an active-project heading, back link, and project-scoped new-case links. Add `#caseProjectId` as the case editor project selector. Ensure mobile styles stack directory cards, toolbar controls, and editor metadata without horizontal clipping.

- [ ] **Step 4: Implement route parsing and project-aware frontend state**

Parse project IDs with `decodeURIComponent`; route legacy case URLs by fetching the case and redirecting to its project route. `#/assets` calls `loadProjects`; project case routes set `activeProjectId`, fetch the project, then call `loadSavedCases` with `projectId`. New case routes call `resetEditor(target, projectId)`, and edit routes verify the case belongs to that route project. Populate the project selector from `GET /api/projects`; include its selected value as `projectId` in both form payload builders.

Build project cards using DOM APIs and `textContent`, not interpolated project names in HTML. Add create/rename/delete handlers; render deletion conflict errors through the existing toast. Update case action hrefs, cancel/delete redirects, batch refreshes, and post-save titles to remain in the active project's asset route.

- [ ] **Step 5: Run static frontend tests and syntax checks**

Run: `npm test -- tests/styles.test.js && node --check app.js && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 6: Commit the project UX**

```bash
git add index.html app.js style.css tests/styles.test.js
git commit -m "feat: add project test asset workspace"
```

### Task 4: Verify migration, UI workflows, and regression suite

**Files:**
- Verify only: `server/storage/sqlite-store.js`, `server/app.js`, `index.html`, `app.js`, `style.css`, `tests/`

**Interfaces:**
- Consumes: complete project asset feature from Tasks 1-3.
- Produces: verified migration behavior and browser evidence for the primary project workflow.

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`

Expected: all Vitest files pass, including existing CMS session reuse, API runner, reports, SQLite, and frontend style assertions.

- [ ] **Step 2: Start the local application and complete browser acceptance**

Run: `npm run dev`

Expected: server prints a local URL. In the in-app browser, create project `社区 CMS`, enter it, create and save one Web UI and one API case, verify both appear only in its list, select both, batch-run them, and verify the workbench/report links still operate. Then confirm a nonempty-project delete action shows an error instead of deleting data.

- [ ] **Step 3: Verify migration against the existing development database**

Run: start the application once with its normal database path, open `#/assets`, and verify every pre-existing asset appears under `默认项目`; inspect one existing report link to confirm history still renders.

- [ ] **Step 4: Review final changes and commit any verification fixes**

Run: `git status --short && git diff --check && git log --oneline -4`

Expected: only task files are staged/committed; `.DS_Store`, `evidence/`, and runtime `data/` changes remain untracked or ignored. Make one focused fix commit only if verification finds a reproducible regression.
