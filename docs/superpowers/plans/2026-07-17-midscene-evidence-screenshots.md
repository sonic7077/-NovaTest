# Midscene Screenshot Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Persist every Midscene step-attempt screenshot in run-scoped directories and show the evidence safely in test reports.

**Architecture:** \`RunService\` supplies a run ID and attempt number. \`WebRunner\` captures success and failure evidence and returns it without replacing the underlying Midscene error. SQLite persists those records; Express only serves files registered to a run; the report turns them into thumbnail links.

**Tech Stack:** Node.js 22, \`node:sqlite\`, Express 5, Playwright, \`@midscene/web\`, Vitest, Supertest.

## Global Constraints

- Cover only Web UI \`action\`, \`assert\`, and \`query\` steps.
- Store evidence at \`data/evidence/<runId>/\`; only relative paths go into SQLite.
- Preserve all attempts and retain the legacy final \`screenshot\` field.
- Do not statically expose \`data/evidence\`.
- The evidence endpoint must reject traversal and files not registered to the requested run.
- Old runs without screenshot arrays must continue to load and report correctly.
- Use \`apply_patch\`; observe a failing test before every implementation change.

---

## File Structure

- \`server/runners/web-runner.js\`: per-attempt success/failure capture.
- \`server/services/run-service.js\`: run ID/attempt context and retry aggregation.
- \`server/storage/sqlite-store.js\`: schema-v3 migration and evidence persistence.
- \`server/app.js\`: allowlisted evidence route.
- \`server/services/report-service.js\`: escaped instruction and thumbnail markup.
- \`tests/web-runner.test.js\`, \`tests/run-service.test.js\`, \`tests/sqlite-store.test.js\`, \`tests/app.test.js\`: regressions.

### Task 1: Capture Runner Evidence

**Files:**
- Modify: \`server/runners/web-runner.js\`
- Modify: \`tests/web-runner.test.js\`

**Interfaces:**
- Consumes \`context.runId\` and \`context.attempt\`.
- Pass result: \`{ variables, screenshot, screenshots: [{ path, attempt, phase }] }\`.
- Fail result: rethrows the same error with an optional \`error.evidence\`.

- [ ] **Step 1: Write failing tests**

\`\`\`js
it('writes success evidence to its run directory', async () => {
  const paths = [];
  const runner = createWebRunner({
    browser: { newPage: async () => ({ screenshot: async ({ path }) => { paths.push(path); return path; } }) },
    agentFactory: () => ({ aiAct: async () => {} }),
    screenshotDir: 'evidence'
  });

  const result = await runner.execute(
    { id: 's1', kind: 'action', instruction: '打开首页' },
    { runId: 'run-1', attempt: 2, viewport: { width: 1440, height: 900 } }
  );

  expect(paths).toEqual(['evidence/run-1/s1-attempt-2.png']);
  expect(result).toMatchObject({
    screenshot: 'run-1/s1-attempt-2.png',
    screenshots: [{ path: 'run-1/s1-attempt-2.png', attempt: 2, phase: 'passed' }]
  });
});

it('attaches failed screenshot evidence without changing the Midscene error', async () => {
  const runner = createWebRunner({
    browser: { newPage: async () => ({ screenshot: async ({ path }) => path }) },
    agentFactory: () => ({ aiAssert: async () => { throw new Error('标题缺失'); } }),
    screenshotDir: 'evidence'
  });

  await expect(runner.execute(
    { id: 's1', kind: 'assert', instruction: '显示标题' },
    { runId: 'run-1', attempt: 1, viewport: { width: 1440, height: 900 } }
  )).rejects.toMatchObject({
    message: '标题缺失',
    evidence: { path: 'run-1/s1-attempt-1.png', attempt: 1, phase: 'failed' }
  });
});
\`\`\`

- [ ] **Step 2: Verify red**

Run: \`npm test -- tests/web-runner.test.js\`

Expected: FAIL because current paths are based only on \`step.id\` and error paths skip screenshots.

- [ ] **Step 3: Implement minimal capture**

Import \`mkdir\` from \`node:fs/promises\` and \`join\` from \`node:path\`. Construct an evidence record with a relative path \`runId/stepId-attempt-N.png\` and an absolute write path under \`screenshotDir\`. Ensure the run directory exists before \`page.screenshot\`.

Run the Midscene operation in \`try/catch\`. On success, capture phase \`passed\` and return it as \`screenshot\` plus a one-element \`screenshots\` array. On failure, capture phase \`failed\`; assign its public fields to \`error.evidence\`; then rethrow the original error. If screenshot capture itself fails, set \`error.evidenceWarning\` and rethrow the original error.

- [ ] **Step 4: Verify green**

Run: \`npm test -- tests/web-runner.test.js\`

Expected: PASS.

- [ ] **Step 5: Commit**

\`\`\`bash
git add server/runners/web-runner.js tests/web-runner.test.js
git commit -m "feat: capture Midscene step evidence"
\`\`\`

### Task 2: Aggregate Evidence Across Retries

**Files:**
- Modify: \`server/services/run-service.js\`
- Modify: \`tests/run-service.test.js\`

**Interfaces:**
- \`RunService\` sets \`executionContext.runId = run.id\` once and \`executionContext.attempt = attempt\` before every runner call.
- Each \`stepRun\` has ordered \`screenshots: []\` and keeps \`screenshot\` as the final evidence path.

- [ ] **Step 1: Write failing test**

\`\`\`js
it('keeps failed and passing evidence through one retry', async () => {
  let calls = 0;
  const runner = {
    execute: async (_step, context) => {
      calls += 1;
      expect(context.runId).toBeTypeOf('string');
      expect(context.attempt).toBe(calls);
      if (calls === 1) {
        const error = new Error('页面未就绪');
        error.evidence = { path: context.runId + '/s1-attempt-1.png', attempt: 1, phase: 'failed' };
        throw error;
      }
      return {
        screenshot: context.runId + '/s1-attempt-2.png',
        screenshots: [{ path: context.runId + '/s1-attempt-2.png', attempt: 2, phase: 'passed' }]
      };
    }
  };

  const run = await new RunService(runner).start(testCase);

  expect(run.steps[0].screenshots).toEqual([
    { path: run.id + '/s1-attempt-1.png', attempt: 1, phase: 'failed' },
    { path: run.id + '/s1-attempt-2.png', attempt: 2, phase: 'passed' }
  ]);
});
\`\`\`

- [ ] **Step 2: Verify red**

Run: \`npm test -- tests/run-service.test.js\`

Expected: FAIL because attempt context and failed evidence are absent.

- [ ] **Step 3: Implement aggregation**

Initialize each step with \`screenshots: []\`. Add \`runId\` to the execution context. Before calling the runner set the current attempt. On a pass append \`evidence.screenshots || []\`; on a failure append \`error.evidence\` when present and log \`error.evidenceWarning\` as a warning. Preserve the current error message and retry behavior.

- [ ] **Step 4: Verify green**

Run: \`npm test -- tests/run-service.test.js\`

Expected: PASS.

- [ ] **Step 5: Commit**

\`\`\`bash
git add server/services/run-service.js tests/run-service.test.js
git commit -m "feat: retain evidence across run retries"
\`\`\`

### Task 3: Persist Screenshot Arrays in SQLite

**Files:**
- Modify: \`server/storage/sqlite-store.js\`
- Modify: \`tests/sqlite-store.test.js\`

**Interfaces:**
- \`saveRun\` writes \`step.screenshots || []\`.
- \`getRun\` returns \`screenshots\` for each step, including \`[]\` for legacy rows.

- [ ] **Step 1: Write failing tests**

\`\`\`js
it('persists every attempt screenshot across SQLite store instances', async () => {
  // save a run with a failed and a passed record, then reopen the database
  expect(reloaded.getRun('run-1').steps[0].screenshots).toEqual([
    { path: 'run-1/s1-attempt-1.png', attempt: 1, phase: 'failed' },
    { path: 'run-1/s1-attempt-2.png', attempt: 2, phase: 'passed' }
  ]);
});

it('migrates a schema-v2 step row to an empty screenshots array once', () => {
  // open a v2 fixture twice
  expect(store.getRun('legacy-run').steps[0].screenshots).toEqual([]);
});
\`\`\`

- [ ] **Step 2: Verify red**

Run: \`npm test -- tests/sqlite-store.test.js\`

Expected: FAIL because \`screenshots_json\` does not exist and run hydration omits it.

- [ ] **Step 3: Implement schema-v3 migration**

After \`migrateHistorySchema()\`, inspect \`PRAGMA table_info(run_steps)\`. If \`screenshots_json\` is absent, run:

\`\`\`sql
ALTER TABLE run_steps ADD COLUMN screenshots_json TEXT NOT NULL DEFAULT '[]';
PRAGMA user_version = 3;
\`\`\`

The check must make reopening the database safe. Select \`screenshots_json\` in \`hydrateRun\`, parse it as \`screenshots\`, and extend the step insert to persist \`JSON.stringify(step.screenshots || [])\`. Keep the existing \`screenshot\` and \`logs_json\` columns untouched.

- [ ] **Step 4: Verify green**

Run: \`npm test -- tests/sqlite-store.test.js\`

Expected: PASS.

- [ ] **Step 5: Commit**

\`\`\`bash
git add server/storage/sqlite-store.js tests/sqlite-store.test.js
git commit -m "feat: persist screenshot evidence records"
\`\`\`

### Task 4: Secure Evidence Delivery and Report Thumbnails

**Files:**
- Modify: \`server/app.js\`
- Modify: \`server/services/report-service.js\`
- Modify: \`tests/app.test.js\`

**Interfaces:**
- \`GET /api/runs/:runId/evidence/:fileName\` returns only files registered to that run.
- \`renderReport(run, caseName)\` renders escaped step instructions and evidence thumbnails.

- [ ] **Step 1: Write failing tests**

\`\`\`js
it('serves only evidence registered to a run', async () => {
  // write evidenceDir/run-1/s1-attempt-1.png and save a matching run
  await request(app).get('/api/runs/run-1/evidence/s1-attempt-1.png').expect(200);
  await request(app).get('/api/runs/run-1/evidence/other.png').expect(404);
  await request(app).get('/api/runs/run-1/evidence/..%2Fpackage.json').expect(404);
});

it('renders escaped instructions with screenshot thumbnail links', () => {
  const report = renderReport(runWithInstructionAndEvidence, '首页验证');
  expect(report).toContain('&lt;script&gt;');
  expect(report).toContain('/api/runs/run-1/evidence/s1-attempt-1.png');
  expect(report).toContain('<img');
});
\`\`\`

- [ ] **Step 2: Verify red**

Run: \`npm test -- tests/app.test.js\`

Expected: FAIL because no evidence route or thumbnail markup exists.

- [ ] **Step 3: Implement route and report**

Extend \`createApp\` with \`evidenceDir = join(projectRoot, 'data/evidence')\`. Build a registered-evidence filename set from \`step.screenshot\` and every \`step.screenshots[].path\`, using \`basename\`. The route must require an existing run, require \`basename(fileName) === fileName\`, require membership in the set, then use \`join(evidenceDir, run.id, fileName)\` and \`res.sendFile\`; missing files return \`404\`.

In \`report-service.js\`, fall back from \`step.screenshots\` to the legacy \`step.screenshot\`, use encoded basenames in \`/api/runs/<runId>/evidence/<fileName>\`, and render each as a thumbnail inside an original-image link. Escape step instructions, error text, and evidence labels.

- [ ] **Step 4: Verify green**

Run: \`npm test -- tests/app.test.js\`

Expected: PASS.

- [ ] **Step 5: Commit**

\`\`\`bash
git add server/app.js server/services/report-service.js tests/app.test.js
git commit -m "feat: show screenshot evidence in reports"
\`\`\`

### Task 5: Full Validation and Browser Check

**Files:**
- Verify only: all files above

- [ ] **Step 1: Run complete suite**

Run: \`npm test\`

Expected: zero failures.

- [ ] **Step 2: Start the server**

Run: \`PORT=4182 npm start\`

Expected: server starts. If model credentials are absent, verify the existing unavailable status instead of attempting a Midscene execution.

- [ ] **Step 3: Verify evidence workflow**

1. With a configured runner, run a Web UI case and open its report.
2. Confirm each registered screenshot has a thumbnail and image link.
3. Request one registered evidence URL and one forged filename; verify image success and \`404\`.
4. Inspect report readability in desktop and \`390x844\` viewport.

- [ ] **Step 4: Final repository check**

Run: \`git diff --check && git status --short\`

Expected: no whitespace errors and only intended files.
