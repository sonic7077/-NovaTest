# Execution and Report Project Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow execution center and quality report users to select a project and filter each page's existing data independently.

**Architecture:** Keep the existing `GET /api/projects`, `GET /api/executions`, and `GET /api/reports` APIs unchanged. Add a project select to both existing filter toolbars, load each select from the project list, and append `projectId` only when a project is selected. The execution poller keeps calling `loadExecutions()`, so it automatically preserves the active project filter.

**Tech Stack:** Vanilla ES modules, HTML/CSS, existing Express API, Vitest.

## Global Constraints

- Default both pages to `全部项目`; an empty value must omit `projectId` from API requests.
- The execution center and quality report project selections are independent page-local controls.
- Preserve existing status, target, and range filters; all selected filters compose through `URLSearchParams`.
- Do not change SQLite schema, server API routes, execution scheduling, report content, or global application state.
- When a selected project produces no results, retain the current empty copy without browser errors.
- The execution poller must retain the active project filter and never show a stale selected task from another project.

---

## File Structure

- `index.html`: adds one project select to the execution center toolbar and one to the quality report toolbar.
- `app.js`: loads project options into both select elements; appends project filters to execution/report requests; resets stale execution selection when filtering hides it.
- `tests/styles.test.js`: protects the UI identifiers, option-loading helper, request parameter use, and change listeners.

### Task 1: Define the Page Filter Contract

**Files:**
- Modify: `tests/styles.test.js`
- Modify: `index.html:59-62`

**Interfaces:**
- Consumes: `GET /api/projects` project objects with `{ id, name }`.
- Produces: `#executionProject` and `#reportProject`, each with an empty `全部项目` option.

- [ ] **Step 1: Write the failing filter-shell test**

Add these assertions inside the existing stylesheet test after the execution/report route assertions:

```js
expect(html).toContain('id="executionProject"');
expect(html).toContain('id="reportProject"');
expect(html).toContain('<option value="">全部项目</option>');
expect(script).toContain('async function loadProjectFilters()');
expect(script).toContain("$('#executionProject')");
expect(script).toContain("$('#reportProject')");
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL because the project filter IDs and helper do not exist.

- [ ] **Step 3: Add the two project select controls**

Change the execution toolbar to begin with:

```html
<select id="executionProject" aria-label="所属项目"><option value="">全部项目</option></select>
```

Change the report toolbar to begin with:

```html
<select id="reportProject" aria-label="所属项目"><option value="">全部项目</option></select>
```

Keep the pre-existing status, target, and range controls in their current order after the new project selector.

- [ ] **Step 4: Run the focused test to confirm the remaining missing helper failure**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL on `loadProjectFilters`, proving the semantic controls are present before their behavior is implemented.

- [ ] **Step 5: Commit the test and filter shell**

```bash
git add tests/styles.test.js index.html
git commit -m "test: define project filters for runs and reports"
```

### Task 2: Load Projects and Compose Filtered Requests

**Files:**
- Modify: `app.js:923-962,984-986`
- Modify: `tests/styles.test.js`

**Interfaces:**
- Consumes: `GET /api/projects` returning `Array<{ id: string, name: string }>`.
- Consumes: current values of `#executionProject`, `#executionStatus`, `#executionTarget`, `#reportProject`, `#reportStatus`, `#reportTarget`, and `#reportRange`.
- Produces: `loadProjectFilters(): Promise<void>`, `GET /api/executions` and `GET /api/reports` requests that omit or include `projectId` correctly.

- [ ] **Step 1: Extend the test with request and stale-selection requirements**

Add these assertions to `tests/styles.test.js`:

```js
expect(script).toContain("query.set('projectId', $('#executionProject').value)");
expect(script).toContain("query.set('projectId', $('#reportProject').value)");
expect(script).toContain("selectedExecutionId = tasks[0]?.id || null");
expect(script).toContain("$('#executionProject').addEventListener('change'");
expect(script).toContain("$('#reportProject').addEventListener('change'");
expect(script).toContain("fetch('/api/projects')");
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL because project option loading, parameter composition, and listener behavior are missing.

- [ ] **Step 3: Implement project option loading**

Add the following helper before `loadExecutions()`:

```js
async function loadProjectFilters() {
  const response = await fetch('/api/projects');
  if (!response.ok) throw new Error('无法读取测试项目');
  const projects = await response.json();
  ['#executionProject', '#reportProject'].forEach((selector) => {
    const select = $(selector);
    const selected = select.value;
    select.innerHTML = '<option value="">全部项目</option>';
    projects.forEach((project) => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      select.append(option);
    });
    select.value = projects.some((project) => project.id === selected) ? selected : '';
  });
}
```

In `renderRoute()`, load project options alongside the selected page's data:

```js
if (view === 'executions') loadProjectFilters().then(() => loadExecutions()).catch((error) => showToast(error.message, true));
if (view === 'reports') loadProjectFilters().then(() => loadReports()).catch((error) => showToast(error.message, true));
```

Replace the existing direct `loadExecutions()` and `loadReports()` route calls so those pages do not request data before project options are ready.

In `loadExecutions()` before status/target filters, add:

```js
if ($('#executionProject').value) query.set('projectId', $('#executionProject').value);
```

Immediately after receiving `tasks`, replace the current `||=` selection with:

```js
const requestedExecutionId = new URLSearchParams(location.hash.split('?')[1] || '').get('focus');
if (!tasks.some((task) => task.id === selectedExecutionId)) selectedExecutionId = tasks.some((task) => task.id === requestedExecutionId) ? requestedExecutionId : tasks[0]?.id || null;
```

In `loadReports()` after initializing `query`, add:

```js
if ($('#reportProject').value) query.set('projectId', $('#reportProject').value);
```

Add these listeners beside the existing execution/report filter listeners:

```js
$('#executionProject').addEventListener('change', () => { selectedExecutionId = null; loadExecutions().catch((error) => showToast(error.message, true)); });
$('#reportProject').addEventListener('change', () => loadReports().catch((error) => showToast(error.message, true)));
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- tests/styles.test.js`

Expected: PASS.

- [ ] **Step 5: Run existing API contract coverage**

Run: `npm test -- tests/app.test.js tests/sqlite-store.test.js`

Expected: PASS; the existing `projectId` filters remain accepted by both store implementations and API routes.

- [ ] **Step 6: Commit the functional filter behavior**

```bash
git add app.js tests/styles.test.js
git commit -m "feat: filter executions and reports by project"
```

### Task 3: Browser Validation and Final Regression

**Files:**
- Modify: none unless verification exposes a defect
- Test: local NovaTest at `http://127.0.0.1:4173/#/executions` and `http://127.0.0.1:4173/#/reports`

**Interfaces:**
- Consumes: completed Tasks 1-2 and at least two persisted testing projects.
- Produces: browser confirmation of default all-project behavior, independent page choices, composed filters, empty result handling, and execution polling preservation.

- [ ] **Step 1: Start or reuse the single local service**

Run: `lsof -nP -iTCP:4173 -sTCP:LISTEN || npm start`

Expected: exactly one NovaTest server listens on `127.0.0.1:4173`.

- [ ] **Step 2: Verify execution center default and project filter**

Open `#/executions`. Confirm the project selector starts at `全部项目`. Select a project and verify the execution request includes that project's ID; task rows and the detail panel contain only that project's items. Change to a project with no tasks and confirm the list shows `暂无执行任务` and the detail shows `暂无选中的执行任务`.

- [ ] **Step 3: Verify report project filter composition**

Open `#/reports`. Confirm the project selector starts at `全部项目`. Select a project, then set status, type, and range. Confirm the report request contains all nonempty values and the list only shows the selected project's reports. Change back to `全部项目` and confirm `projectId` is omitted.

- [ ] **Step 4: Verify execution filter persists during refresh**

With a project selected in `#/executions`, wait for one 1.5-second poll interval and confirm the subsequent execution request still includes the same `projectId`.

- [ ] **Step 5: Run final automated verification**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit any browser-found correction**

```bash
git add app.js index.html style.css tests/styles.test.js
git commit -m "fix: polish project filter behavior"
```

Only create this commit if browser validation identifies a correction.

## Plan Self-Review

- **Spec coverage:** Task 1 adds both default-all controls. Task 2 loads real projects, composes `projectId` with all existing filters, preserves selection during polling, handles stale IDs, and keeps API contracts unchanged. Task 3 validates independent page state, empty results, composed filters, and polling.
- **Placeholder scan:** Every production edit includes exact file paths, code, command, and expected test outcome. The final optional commit has a precise condition and does not defer behavior.
- **Type consistency:** `loadProjectFilters`, `executionProject`, `reportProject`, and `projectId` use identical names across HTML, JavaScript, requests, tests, and browser validation.
