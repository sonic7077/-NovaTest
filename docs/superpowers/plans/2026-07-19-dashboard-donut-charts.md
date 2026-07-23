# Dashboard Donut Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the dashboard's execution trend and execution type panels as live, accessible SVG donut charts backed by the existing dashboard aggregate API.

**Architecture:** Keep `GET /api/dashboard` and its SQLite aggregation unchanged. Replace `loadDashboard()`'s text-only output with client-side render helpers: the trend helper combines an overall pass/fail donut with daily stacked bars, while the target helper renders a Web UI/API allocation donut and textual legend. CSS owns visual layout and transition behavior; all values remain visible as text for accessibility.

**Tech Stack:** Vanilla ES modules, browser DOM/SVG APIs, existing CSS, Vitest, Express/SQLite test suite.

## Global Constraints

- Do not add chart, animation, or UI dependencies.
- Use only final `passed`/`failed` runs returned from the existing `GET /api/dashboard?range=today|7d|30d` response.
- Preserve the existing page routes, dashboard range selector, top metrics, failure/report lists, and backend API contract.
- Never render fake execution progress or hard-coded result values.
- Render safe empty states and never emit `NaN`, Infinity, or a divide-by-zero percentage.
- SVGs must have `role="img"`, readable `aria-label` text, and adjacent textual legend values.
- Retain desktop two-column behavior; at widths at or below 760px charts must stack without text overflow.

---

## File Structure

- `index.html`: retains the existing dashboard panel targets and adds stable class hooks only if needed by the renderer.
- `app.js`: defines data-normalization, SVG donut, trend, and target render helpers; `loadDashboard()` delegates the two panel regions to them.
- `style.css`: lays out donut/legend/trend widgets, defines the data-refresh transition, and provides narrow-screen behavior.
- `tests/styles.test.js`: verifies the dashboard shell, renderer names, accessibility hooks, and responsive CSS contract without loading a browser.

### Task 1: Establish Dashboard Chart Contract

**Files:**
- Modify: `tests/styles.test.js`
- Modify: `index.html:51-55`

**Interfaces:**
- Consumes: existing `#dashboardTrend` and `#dashboardTargetBreakdown` panel containers.
- Produces: stable chart containers `.dashboard-chart`, `.dashboard-donut`, `.dashboard-legend`, `.dashboard-daily-bars` referenced by rendering and styling tasks.

- [ ] **Step 1: Write the failing static UI contract test**

Add the following assertions inside the existing `defines the base layout, editor and responsive rules` test, after the existing dashboard assertions:

```js
expect(html).toContain('id="dashboardTrend"');
expect(html).toContain('id="dashboardTargetBreakdown"');
expect(script).toContain('function renderDashboardTrend(');
expect(script).toContain('function renderDashboardTargetBreakdown(');
expect(script).toContain('function createDashboardDonut(');
expect(script).toContain("svg.setAttribute('role', 'img')");
expect(stylesheet).toContain('.dashboard-chart');
expect(stylesheet).toContain('.dashboard-donut');
expect(stylesheet).toContain('.dashboard-daily-bars');
expect(stylesheet).toContain('@media (max-width: 760px)');
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL because the renderer function and chart CSS identifiers do not exist.

- [ ] **Step 3: Add minimal semantic dashboard shell hooks**

Keep both existing `id` values. Update their class names in `index.html` to use a chart-specific loading state:

```html
<div id="dashboardTrend" class="dashboard-chart chart-empty">正在读取统计数据...</div>
<div id="dashboardTargetBreakdown" class="dashboard-chart chart-empty">正在读取统计数据...</div>
```

Do not pre-populate SVG or result values in HTML. The containers must be populated solely by the real API response.

- [ ] **Step 4: Run the focused test to confirm it still fails for implementation identifiers**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL only on missing app/CSS chart contract assertions.

- [ ] **Step 5: Commit the test and semantic shell**

```bash
git add tests/styles.test.js index.html
git commit -m "test: define dashboard chart contract"
```

### Task 2: Render Real SVG Donuts and Trend Data

**Files:**
- Modify: `app.js:581-594`
- Modify: `tests/styles.test.js`

**Interfaces:**
- Consumes: `{ completedRuns, passedRuns, failedRuns, daily, targets }` from `/api/dashboard`.
- Produces: `renderDashboardTrend(data)` and `renderDashboardTargetBreakdown(data)`, each rendering into its named dashboard container.
- Produces: `createDashboardDonut({ label, total, segments })`, returning one SVG donut with `role="img"` and an accessible label.

- [ ] **Step 1: Extend the failing test for normalization and no-data behavior**

Add static expectations that define the safety and empty-state contract:

```js
expect(script).toContain('function nonNegativeNumber(');
expect(script).toContain("'所选时间范围内暂无已完成执行记录'");
expect(script).toContain("target === 'web'");
expect(script).toContain("target === 'api'");
expect(script).toContain('const maxDailyTotal = Math.max(');
expect(script).toContain("svg.setAttribute('aria-label', ariaLabel)");
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL because none of the required normalization or SVG renderer snippets exist.

- [ ] **Step 3: Implement the minimal data and SVG helpers in `app.js` before `loadDashboard()`**

```js
function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function createDashboardDonut({ label, total, segments }) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const safeTotal = nonNegativeNumber(total);
  const ariaLabel = `${label}：${safeTotal} 次完成运行`;
  svg.classList.add('dashboard-donut');
  svg.setAttribute('viewBox', '0 0 42 42');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ariaLabel);
  const track = document.createElementNS(svg.namespaceURI, 'circle');
  track.setAttribute('class', 'dashboard-donut-track');
  track.setAttribute('cx', '21'); track.setAttribute('cy', '21'); track.setAttribute('r', '15.9155');
  svg.append(track);
  let offset = 25;
  segments.filter((segment) => segment.value > 0).forEach((segment) => {
    const circle = document.createElementNS(svg.namespaceURI, 'circle');
    const percentage = safeTotal ? (segment.value / safeTotal) * 100 : 0;
    circle.setAttribute('class', `dashboard-donut-segment ${segment.tone}`);
    circle.setAttribute('cx', '21'); circle.setAttribute('cy', '21'); circle.setAttribute('r', '15.9155');
    circle.setAttribute('stroke-dasharray', `${percentage} ${100 - percentage}`);
    circle.setAttribute('stroke-dashoffset', String(offset));
    offset -= percentage;
    svg.append(circle);
  });
  return svg;
}
```

Then create DOM nodes with `textContent`, never API-sourced `innerHTML`. `renderDashboardTrend(data)` must return the existing empty sentence when `completedRuns` is zero or `daily` is empty. Otherwise render the pass/fail donut, text legend, and daily bars. `renderDashboardTargetBreakdown(data)` must filter `data.targets` to `target === 'web' || target === 'api'`; it must render the empty sentence when no known target remains. In `loadDashboard()`, replace both existing newline `textContent` assignments with:

```js
renderDashboardTrend(data);
renderDashboardTargetBreakdown(data);
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- tests/styles.test.js`

Expected: PASS with all prior static UI checks still green.

- [ ] **Step 5: Run API regression coverage**

Run: `npm test -- tests/app.test.js`

Expected: PASS; `/api/dashboard` continues to expose the unchanged summary, `daily`, and `targets` fields.

- [ ] **Step 6: Commit the renderer**

```bash
git add app.js tests/styles.test.js
git commit -m "feat: render dashboard donut charts"
```

### Task 3: Style Transitions and Responsive Chart Layout

**Files:**
- Modify: `style.css:238-240`
- Modify: `tests/styles.test.js`

**Interfaces:**
- Consumes: `.dashboard-chart`, `.dashboard-donut`, `.dashboard-donut-segment`, `.dashboard-legend`, `.dashboard-daily-bars`, and `.dashboard-daily-bar` emitted by Task 2.
- Produces: desktop chart composition, transition behavior, no-data alignment, and narrow-screen stacking.

- [ ] **Step 1: Add the failing visual-style contract test**

Add these assertions to `tests/styles.test.js`:

```js
expect(stylesheet).toContain('.dashboard-chart-content');
expect(stylesheet).toContain('.dashboard-donut-segment { transition: stroke-dasharray .45s ease, stroke-dashoffset .45s ease; }');
expect(stylesheet).toContain('.dashboard-daily-bar-fill { transition: height .45s ease; }');
expect(stylesheet).toContain('.dashboard-target-chart');
expect(stylesheet).toContain('.dashboard-daily-scroll');
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL because chart layout and animation selectors do not yet exist.

- [ ] **Step 3: Add exact CSS for data-driven chart presentation**

Place the following chart rules immediately after `.chart-empty`:

```css
.dashboard-chart { min-height: 170px; }
.dashboard-chart-content { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 18px; align-items: center; min-height: 170px; padding: 18px 0 2px; }
.dashboard-donut-wrap { position: relative; display: grid; width: 120px; height: 120px; place-items: center; }
.dashboard-donut { width: 120px; height: 120px; overflow: visible; transform: rotate(-90deg); }
.dashboard-donut-track, .dashboard-donut-segment { fill: none; stroke-width: 5; }
.dashboard-donut-track { stroke: #edf1ef; }
.dashboard-donut-segment { stroke-linecap: butt; }
.dashboard-donut-segment.pass { stroke: #238f60; }
.dashboard-donut-segment.fail { stroke: #d15c5c; }
.dashboard-donut-segment.web { stroke: #1a7fb5; }
.dashboard-donut-segment.api { stroke: #d88927; }
.dashboard-donut-segment { transition: stroke-dasharray .45s ease, stroke-dashoffset .45s ease; }
.dashboard-donut-center { position: absolute; display: grid; place-items: center; text-align: center; pointer-events: none; }
.dashboard-donut-center b { color: #263c32; font: 700 17px "DM Mono", monospace; }
.dashboard-donut-center small, .dashboard-legend { color: var(--muted); font-size: 10px; }
.dashboard-legend { display: grid; gap: 7px; }
.dashboard-legend-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.dashboard-legend-label { display: inline-flex; align-items: center; gap: 6px; }.dashboard-legend-dot { width: 7px; height: 7px; border-radius: 50%; }
.dashboard-daily-scroll { min-width: 0; overflow-x: auto; padding-bottom: 4px; }
.dashboard-daily-bars { display: flex; align-items: end; min-width: 252px; height: 128px; gap: 8px; border-bottom: 1px solid #e8eeea; }
.dashboard-daily-bar { display: grid; flex: 1; min-width: 22px; height: 100%; grid-template-rows: 1fr auto; gap: 6px; justify-items: center; color: var(--muted); font-size: 9px; }
.dashboard-daily-bar-stack { display: flex; width: 100%; height: 100%; align-items: end; flex-direction: column-reverse; justify-content: end; background: #f0f4f2; border-radius: 3px 3px 0 0; overflow: hidden; }
.dashboard-daily-bar-fill { width: 100%; transition: height .45s ease; }.dashboard-daily-bar-fill.pass { background: #3aa877; }.dashboard-daily-bar-fill.fail { background: #d96b6b; }
.dashboard-target-chart { grid-template-columns: 132px minmax(0, 1fr); }
```

Add this narrow-screen rule inside the existing `@media (max-width: 760px)` block:

```css
.dashboard-chart-content, .dashboard-target-chart { grid-template-columns: 1fr; justify-items: center; }
.dashboard-chart-content > .dashboard-daily-scroll, .dashboard-chart-content > .dashboard-legend { width: 100%; }
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- tests/styles.test.js`

Expected: PASS.

- [ ] **Step 5: Run all tests to detect unrelated regression**

Run: `npm test`

Expected: PASS with every Vitest suite green.

- [ ] **Step 6: Commit the styling**

```bash
git add style.css tests/styles.test.js
git commit -m "feat: style responsive dashboard charts"
```

### Task 4: Browser Verification of Real Dashboard States

**Files:**
- Modify: none unless a defect is found
- Test: local application at `http://127.0.0.1:<configured-port>/#/dashboard`

**Interfaces:**
- Consumes: completed Tasks 1-3 and the existing local server startup command `npm start`.
- Produces: visual confirmation that real dashboard data, empty states, time range selection, and mobile layout render without overlap.

- [ ] **Step 1: Start the local application**

Run: `npm start`

Expected: a single server URL is printed; use that one URL for all browser checks.

- [ ] **Step 2: Verify desktop dashboard rendering with the in-app browser**

At 1440 x 900, open `#/dashboard`, wait for the dashboard request, and confirm:

```text
- The left panel shows an SVG overall pass/fail donut and date-labelled daily bars when final runs exist.
- The right panel shows the Web UI/API donut and textual legend when known target data exists.
- The four top metrics equal the same response used by the diagrams.
- Neither panel contains raw multi-line text such as "2026-...: 1 通过 / 0 失败".
```

- [ ] **Step 3: Verify time range refresh and empty states**

Click each range selector (`今日`, `最近 7 天`, `最近 30 天`) and confirm both diagrams change from the matching request. For a range with no completed data, confirm the exact empty-state sentence is shown and no `NaN` text appears.

- [ ] **Step 4: Verify narrow-screen layout**

At 390 x 844, reload `#/dashboard` and confirm both donut widgets are centered, legends remain readable, and daily bars remain contained or scroll horizontally inside their own area without page-wide overflow.

- [ ] **Step 5: Run final automated verification**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit any browser-found correction**

```bash
git add app.js index.html style.css tests/styles.test.js
git commit -m "fix: polish dashboard chart rendering"
```

Only create this commit if the browser verification required a correction.

## Plan Self-Review

- **Spec coverage:** Task 2 implements live SVG donuts, data normalization, passed/failed and type calculations, accessible labels, and empty states. Task 3 provides the specified data-refresh transition and responsive composition. Task 4 validates range updates, no-data, desktop, and mobile behavior. The unchanged endpoint and all preserved dashboard responsibilities are stated in global constraints.
- **Placeholder scan:** No deferred work, unspecified interfaces, or generic test instructions remain; every task lists exact files, commands, expected outcomes, and code where production changes are introduced.
- **Type consistency:** Both renderer functions consume the established dashboard response names; CSS selectors in Task 3 correspond to the DOM classes explicitly produced by Task 2.
