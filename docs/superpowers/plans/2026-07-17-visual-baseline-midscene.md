# Visual Baseline Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Let Web UI case steps accept uploaded or promoted reference screenshots and use Midscene visual reasoning to stabilize functional checks.

**Architecture:** Store reference images separately under data/case-assets/caseId and persist step visualChecks as JSON. The runner compares the current page with each referenced image through Midscene; app endpoints whitelist every asset; the editor manages assets and the report renders the comparison result.

**Tech Stack:** Node.js 22, Express 5, node:sqlite, Playwright, @midscene/web, Vitest, Supertest.

## Global Constraints

- Accept PNG, JPEG and WebP only; each asset is at most 5MB.
- Never serve data/case-assets through static middleware.
- Asset records are case-scoped and paths are relative.
- Existing cases with no visualChecks must execute unchanged.
- Use TDD and apply_patch for every code change.

---

### Task 1: Case model and SQLite visual checks

**Files:** server/domain/case.js, server/storage/sqlite-store.js, tests/case.test.js, tests/sqlite-store.test.js

**Interfaces:** A step accepts visualChecks: [{ id, assetPath, source, description }]. getCase and saveCase preserve the property.

- [ ] Step 1: Write failing domain and persistence tests for a valid visual check, invalid source/path/description, and SQLite reload.
- [ ] Step 2: Run npm test -- tests/case.test.js tests/sqlite-store.test.js; verify validation and persistence fail.
- [ ] Step 3: Validate source in upload/run, require nonempty description and a relative assetPath beginning with the current case id. Add visual_checks_json TEXT NOT NULL DEFAULT '[]' to test_steps through idempotent schema-v4 migration; parse and write it.
- [ ] Step 4: Run npm test -- tests/case.test.js tests/sqlite-store.test.js; verify pass.
- [ ] Step 5: Commit git add server/domain/case.js server/storage/sqlite-store.js tests/case.test.js tests/sqlite-store.test.js && git commit -m "feat: persist visual test baselines"

### Task 2: Case-scoped image asset API

**Files:** server/app.js, server/services/case-asset-service.js, tests/app.test.js

**Interfaces:** CaseAssetService.saveUpload({ caseId, file }) returns { id, assetPath, source: 'upload' }; promoteRunEvidence({ caseId, runId, fileName, description }) returns a source run asset. Routes POST /api/cases/:caseId/assets, GET /api/cases/:caseId/assets/:fileName, POST /api/cases/:caseId/visual-baselines.

- [ ] Step 1: Write failing Supertest cases using multipart data for PNG upload success, text-file and >5MB rejection, cross-case GET rejection, and promotion of a registered run screenshot.
- [ ] Step 2: Run npm test -- tests/app.test.js; verify routes do not exist.
- [ ] Step 3: Add multer dependency only if Express lacks multipart parsing. In CaseAssetService, generate UUID file names, validate MIME and bytes, save under data/case-assets/caseId, and validate promotion against run screenshot allowlist before copying. Use basename and resolved-path containment checks for every read.
- [ ] Step 4: Run npm test -- tests/app.test.js; verify pass.
- [ ] Step 5: Commit git add package.json package-lock.json server/app.js server/services/case-asset-service.js tests/app.test.js && git commit -m "feat: manage visual baseline assets"

### Task 3: Midscene semantic visual assertions

**Files:** server/runners/web-runner.js, server/services/run-service.js, tests/web-runner.test.js, tests/run-service.test.js

**Interfaces:** Runner receives step.visualChecks and calls agent.aiAssert with instruction, visual description, reference image path and current screenshot. It returns visualChecks: [{ id, status, reason, baselinePath, screenshot }].

- [ ] Step 1: Write failing runner tests that assert one visual check calls the Midscene agent after action completion; a rejected visual assertion returns its reason and preserves current screenshot evidence. Add a RunService test for visual result persistence on retry.
- [ ] Step 2: Run npm test -- tests/web-runner.test.js tests/run-service.test.js; verify visual checks are ignored.
- [ ] Step 3: Add an injected asset resolver to WebRunner. After current screenshot capture, call agent.aiAssert with a prompt containing the step instruction, check description, baseline file path and current screenshot path. Return passed results; attach failed visual result to the error without hiding the original model reason. Aggregate visualChecks on stepRun.
- [ ] Step 4: Run npm test -- tests/web-runner.test.js tests/run-service.test.js; verify pass.
- [ ] Step 5: Commit git add server/runners/web-runner.js server/services/run-service.js tests/web-runner.test.js tests/run-service.test.js && git commit -m "feat: evaluate visual test baselines with Midscene"

### Task 4: Editor, promotion and report display

**Files:** index.html, app.js, style.css, server/services/report-service.js, tests/styles.test.js, tests/app.test.js

**Interfaces:** Each step card renders visual baseline controls. Report renders baseline image, execution image, status and model reason.

- [ ] Step 1: Write failing static UI assertions for visual-baseline controls, file input, baseline thumbnail and promotion action; add report assertion for visual comparison markup.
- [ ] Step 2: Run npm test -- tests/styles.test.js tests/app.test.js; verify controls and markup are absent.
- [ ] Step 3: Add per-step asset upload button and hidden file input; upload through multipart endpoint, bind returned visualCheck with editable description, use textContent for labels, and support remove before save. Add report markup using case asset URL and evidence URL. Keep dashboard free of CRUD controls.
- [ ] Step 4: Run npm test -- tests/styles.test.js tests/app.test.js; verify pass.
- [ ] Step 5: Commit git add index.html app.js style.css server/services/report-service.js tests/styles.test.js tests/app.test.js && git commit -m "feat: edit and report visual baselines"

### Task 5: End-to-end verification

- [ ] Step 1: Run npm test; expect zero failures.
- [ ] Step 2: Start PORT=4182 npm start. With configured Midscene model, upload a baseline, save a case, execute, promote a successful screenshot, and inspect the report. Without configuration, verify the explicit unavailable status and API/upload workflow.
- [ ] Step 3: Inspect desktop and 390x844 editor layout; confirm upload preview, description editing, removal, and report links do not overlap.
- [ ] Step 4: Run git diff --check && git status --short; expect no whitespace errors.
