# 方舟社区审核串联用例 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为“方舟社区发帖”项目落库可授权执行的帖子、评论和用户资料审核串联用例，并在报告中清楚区分接口失败、未授权写入和前置数据不足。

**Architecture:** 执行 API 用例时，`RunService` 将批次级写入授权和共享选择状态传递给 `CmsApiRunner`。运行器使用解密响应中的业务 ID 完成变量提取或列表选择，在缺少待审核记录时抛出可识别的前置条件异常而不重试；`BatchService` 据此汇总通过、失败与跳过的运行结果。用例定义集中在方舟社区 seed 文件，启动时幂等同步到 SQLite。

**Tech Stack:** Node.js 22、Express 5、Vitest 3、SQLite、原生 `fetch`、CMS AES-CBC 加密运行器、原生 HTML/CSS/JavaScript。

## Global Constraints

- 不新增或执行 `del_post`、`del_post_comments`、`del_member_update_log`，也不引入自动清理动作。
- 写操作默认关闭；仅当单次或批量请求显式携带 `allowMutations: true` 时才允许发出请求。
- 仅从运行时环境读取 CMS 密钥、账号、密码、Google TOTP 秘钥和 App Key；不得提交它们或任何 Token、密文 `data`、签名 `sign`。
- 同一 API 批次只登录一次，Token 只能位于内存 Session，不能写入运行变量、SQLite 或报告。
- 报告仅展示脱敏后的解密业务响应，失败步骤同样保留脱敏请求和响应证据。
- 方舟社区的动态 ID 仅存在于当前运行或当前批次内存状态，不能作为固定测试数据保存。

---

## File Structure

- `server/runners/cms-api-runner.js`: 解密响应断言、变量提取、列表项选择与前置条件错误。
- `server/domain/case.js`: 校验 API 用例中 `expectedJson` 的变量比较和 `select` 配置。
- `server/services/run-service.js`: 将写入授权、选择状态和跳过结论带入单条运行。
- `server/services/batch-service.js`: 创建并共享批次 API Session 与已选择 ID 集合，汇总跳过运行。
- `server/services/execution-service.js`: 排队执行时保存并透传 `allowMutations`。
- `server/app.js`: 单条/批量运行接口接收写入确认，并把跳过运行纳入执行和报告查询。
- `server/seed/ark-community-cases.js`: 定义非删除的方舟社区读写业务链并幂等同步。
- `app.js`, `index.html`, `style.css`: 写入确认交互、API 编辑器的选择配置、跳过状态的执行和报告展示。
- `tests/cms-api-runner.test.js`, `tests/run-service.test.js`, `tests/batch-service.test.js`, `tests/app.test.js`, `tests/ark-community-cases.test.js`: 覆盖每个边界和端到端请求路径。

### Task 1: Add explicit precondition and dynamic API selection support

**Files:**
- Modify: `server/runners/cms-api-runner.js`
- Modify: `server/domain/case.js`
- Test: `tests/cms-api-runner.test.js`
- Test: `tests/case.test.js`

**Interfaces:**
- Consumes: API step `request.extract` as `{ [variableName]: '$.json.path' }` and optional `request.select` as `{ listPath, variable, idPath }`.
- Produces: `PreconditionError` with `code === 'PRECONDITION_UNAVAILABLE'`, redacted `api` evidence, and a business-value-only `variables` object.

- [ ] **Step 1: Write failing runner tests for required extraction, selection, and variable assertions**

```js
it('selects an unused pending member ID and reserves it for the batch', async () => {
  const context = { testCase: { baseUrl: 'https://example.test' }, variables: {},
    apiSession: {}, selectedApiIds: new Set(['member-1']), allowMutations: true };
  const result = await runner.execute({ id: 'select-member', request: {
    action: 'list_member_update_log', method: 'POST', payload: { status: 0 },
    expectedStatus: 1, safety: 'readonly',
    select: { listPath: '$.data.list', variable: 'memberLogId', idPath: '$.id' }
  } }, context);
  expect(result.variables).toEqual({ memberLogId: 'member-2' });
  expect(context.selectedApiIds).toEqual(new Set(['member-1', 'member-2']));
});

it('raises a precondition outcome when no selectable pending record exists', async () => {
  await expect(runner.execute(memberSelectionStep, emptyListContext)).rejects.toMatchObject({
    code: 'PRECONDITION_UNAVAILABLE', message: expect.stringContaining('前置数据不足')
  });
});

it('compares decrypted JSON values to an earlier business variable', async () => {
  await expect(runner.execute({ ...detailStep, request: {
    ...detailStep.request, expectedJson: [{ path: '$.data.id', equalsVariable: 'postId' }]
  } }, { ...context, variables: { postId: 42 } })).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- tests/cms-api-runner.test.js tests/case.test.js`

Expected: FAIL because `request.select`, `equalsVariable`, and `PRECONDITION_UNAVAILABLE` do not exist.

- [ ] **Step 3: Implement the smallest runner and schema extension**

```js
export class PreconditionError extends Error {
  constructor(message, api) {
    super(message);
    this.name = 'PreconditionError';
    this.code = 'PRECONDITION_UNAVAILABLE';
    this.api = api;
  }
}

function selectListVariable(data, select, selectedApiIds, api) {
  const list = jsonPathValue(data, select.listPath);
  const candidate = Array.isArray(list) && list.find((item) => {
    const id = jsonPathValue(item, select.idPath);
    return id !== undefined && !selectedApiIds.has(String(id));
  });
  if (!candidate) throw new PreconditionError('前置数据不足：没有可用于本次审核的待处理记录', api);
  const id = jsonPathValue(candidate, select.idPath);
  selectedApiIds.add(String(id));
  return { [select.variable]: id };
}
```

Update `assertJson(data, expectedJson, variables)` so an assertion containing `equalsVariable` reads `variables[equalsVariable]`, rejects an absent source variable, and compares the JSON value exactly. Keep existing `exists` and `equals` behavior intact. Update `validateWebCase` to accept only a `select` object with nonempty `listPath`, `variable`, and `idPath`, all valid JSON paths; reject an `equalsVariable` that is not a nonempty string.

- [ ] **Step 4: Run focused tests and then the full suite**

Run: `npm test -- tests/cms-api-runner.test.js tests/case.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS with no changes to encryption, redaction, or existing read-only cases.

- [ ] **Step 5: Commit the isolated behavior**

```bash
git add server/runners/cms-api-runner.js server/domain/case.js tests/cms-api-runner.test.js tests/case.test.js
git commit -m "feat: support API precondition selection"
```

### Task 2: Carry write authorization and precondition outcomes through runs and batches

**Files:**
- Modify: `server/services/run-service.js`
- Modify: `server/services/batch-service.js`
- Modify: `server/services/execution-service.js`
- Test: `tests/run-service.test.js`
- Test: `tests/batch-service.test.js`

**Interfaces:**
- Consumes: `RunService.start(testCase, { allowMutations, selectedApiIds, apiSession })`.
- Produces: runs with status `passed`, `failed`, or `skipped`; batches with status `passed` when every run is passed/skipped and a `skippedCases` count derivable from their runs.

- [ ] **Step 1: Write failing run and batch service tests**

```js
it('marks a precondition error as skipped without retrying the step', async () => {
  const runner = { execute: async () => { throw Object.assign(new Error('前置数据不足'), { code: 'PRECONDITION_UNAVAILABLE' }); } };
  const run = await new RunService(runner).start(secondCase);
  expect(run).toMatchObject({ status: 'skipped', steps: [{ status: 'skipped', attempts: 1 }] });
});

it('passes explicit write permission and one ID reservation set to every API run in a batch', async () => {
  const seen = [];
  const api = { createSession: () => ({}), execute: async (_step, context) => { seen.push(context); return {}; } };
  await new BatchService({ runner: { api }, store }).start({ ...apiBatch, allowMutations: true });
  expect(seen.every((context) => context.allowMutations)).toBe(true);
  expect(new Set(seen.map((context) => context.selectedApiIds))).toHaveLength(1);
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- tests/run-service.test.js tests/batch-service.test.js`

Expected: FAIL because runs retry and fail precondition errors, and batch contexts omit authorization and selected IDs.

- [ ] **Step 3: Implement propagation and outcome handling**

```js
// RunService.start catch branch
if (error.code === 'PRECONDITION_UNAVAILABLE') {
  stepRun.status = 'skipped';
  stepRun.error = error.message;
  if (error.api) stepRun.api = error.api;
  run.status = 'skipped';
  run.finishedAt = new Date().toISOString();
  publish();
  return run;
}
```

Add `allowMutations` to queued run and batch records as a boolean audit flag. In `BatchService.execute`, initialize exactly one `const selectedApiIds = new Set()` beside the shared API session, then pass it and `batch.allowMutations` to every `runService.start` call. In `ExecutionService`, accept `allowMutations` in `queueRun` and `queueBatch`, persist it before scheduling, and pass it downstream. A batch is `passed` only when no run is `failed`; skipped runs are not counted as passed.

- [ ] **Step 4: Run focused tests and the full suite**

Run: `npm test -- tests/run-service.test.js tests/batch-service.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit the execution-service change**

```bash
git add server/services/run-service.js server/services/batch-service.js server/services/execution-service.js tests/run-service.test.js tests/batch-service.test.js
git commit -m "feat: authorize mutation runs explicitly"
```

### Task 3: Expose explicit mutation approval and skipped status through HTTP and the UI

**Files:**
- Modify: `server/app.js`
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`
- Test: `tests/app.test.js`
- Test: `tests/styles.test.js`

**Interfaces:**
- Consumes: `POST /api/cases/:id/runs` and `POST /api/batches` bodies with optional `{ "allowMutations": true }`.
- Produces: queued run/batch JSON containing the audit flag, and an asset-page confirmation only when selected steps have `safety: 'mutating'`.

- [ ] **Step 1: Write failing HTTP and UI-source tests**

```js
it('passes an explicit allowMutations flag into a queued case run', async () => {
  const created = (await request(app).post('/api/cases').send(mutatingApiCase)).body;
  await request(app).post(`/api/cases/${created.id}/runs`).send({ allowMutations: true }).expect(202)
    .expect(({ body }) => expect(body.allowMutations).toBe(true));
});

it('keeps the write permission false when the request omits it', async () => {
  await request(app).post('/api/batches').send({ caseIds: [mutatingApiCase.id] }).expect(202)
    .expect(({ body }) => expect(body.allowMutations).toBe(false));
});
```

Add source-level assertions that `app.js` checks `testCase.steps.some((step) => step.request?.safety === 'mutating')`, calls `window.confirm`, and serializes `{ allowMutations }` for single runs, batch runs, and API debugging. Add CSS checks for `.batch-status.skipped` and `.execution-step.skipped`.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- tests/app.test.js tests/styles.test.js`

Expected: FAIL because endpoints ignore the body and the UI has no confirmation or skipped styling.

- [ ] **Step 3: Implement the endpoint and UI behavior**

```js
function requestedMutationAuthorization(value) {
  return value === true;
}

app.post('/api/cases/:id/runs', (req, res) => {
  const testCase = store.getCase(req.params.id);
  if (!testCase) return res.status(404).json({ error: 'test case not found' });
  return res.status(202).json(executionService.queueRun(testCase, {
    allowMutations: requestedMutationAuthorization(req.body?.allowMutations)
  }));
});
```

Apply the same boolean parsing to `POST /api/batches`. In the browser, add one helper that returns `false` for a fully read-only selection and otherwise invokes a confirmation naming the number of write-capable cases. Send the resulting boolean with each run request. Extend execution filters, detail conclusion, history counts, report links, and status CSS so `skipped` reads as “前置数据不足” rather than as a failure.

Add a `选择列表项` JSON field to the API editor. It must round-trip `request.select` in `renderApiStepNode`, `readApiCaseFromForm`, editor preview, and new-case defaults. The placeholder must use the exact schema:

```json
{
  "listPath": "$.data.list",
  "variable": "memberLogId",
  "idPath": "$.id"
}
```

- [ ] **Step 4: Run focused tests and a browser smoke check**

Run: `npm test -- tests/app.test.js tests/styles.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

Start the local server, open the test asset page, and verify a mutation-capable case asks for confirmation while a read-only case starts without it. Verify a skipped execution has a readable conclusion and report link.

- [ ] **Step 5: Commit HTTP and UI changes**

```bash
git add server/app.js index.html app.js style.css tests/app.test.js tests/styles.test.js
git commit -m "feat: confirm API mutation execution"
```

### Task 4: Seed the non-delete community business chains

**Files:**
- Modify: `server/seed/ark-community-cases.js`
- Test: `tests/ark-community-cases.test.js`
- Test: `tests/app.test.js`

**Interfaces:**
- Consumes: `arkCommunityCases({ projectId, baseUrl })` and the runtime CMS environment in `server/index.js`.
- Produces: idempotently saved API assets under “方舟社区发帖”, all non-delete actions with deterministic case IDs and `mutating` safety labels.

- [ ] **Step 1: Write failing seed tests**

```js
it('defines only non-delete community actions and marks business writes as mutating', () => {
  const cases = arkCommunityCases({ projectId: 'ark-project', baseUrl: 'https://example.test' });
  const actions = cases.flatMap((testCase) => testCase.steps.map((step) => step.request.action));
  expect(actions).not.toEqual(expect.arrayContaining(['del_post', 'del_post_comments', 'del_member_update_log']));
  expect(cases.find((item) => item.id === 'ark-community-member-approve').steps[0].request.select)
    .toEqual({ listPath: '$.data.list', variable: 'memberLogId', idPath: '$.id' });
  expect(cases.flatMap((item) => item.steps).filter((step) => step.request.action === 'pass_post').every((step) => step.request.safety === 'mutating')).toBe(true);
});

it('refreshes the complete seeded case set without duplicates', () => {
  seedArkCommunityCases(store, { baseUrl: 'https://first.test' });
  seedArkCommunityCases(store, { baseUrl: 'https://second.test' });
  expect(store.listCases('', project.id).map((item) => item.id)).toContain('ark-community-comment-reject');
});
```

- [ ] **Step 2: Run the focused seed tests to verify they fail**

Run: `npm test -- tests/ark-community-cases.test.js tests/app.test.js`

Expected: FAIL because the current seed contains only read-only cases.

- [ ] **Step 3: Implement explicit cases, without sensitive values or delete actions**

Keep existing query and invalid-token probes. Add stable-ID case definitions for:

```text
ark-community-post-approve
ark-community-post-reject
ark-community-comment-approve
ark-community-comment-reject
ark-community-comment-reply
ark-community-member-approve
ark-community-member-reject
```

Each post chain creates uniquely named non-draft test content with `{{runId}}`, extracts `postId`, then verifies its own returned ID through `list_post` and `detail_post`. The approve and reject cases use separate chains and explicit status assertions. Comment cases create a dedicated post, create comments, list by extracted `postId`, select or extract the comment ID, audit it, and query that same ID and target status. The reply chain first creates and approves its parent comment, then calls `reply_post_comments` and verifies the resulting list.

For each member case, first call `list_member_update_log` with `{ status: 0, page: 1, limit: 10 }`, use `request.select` to reserve one returned ID, call its pass or reject endpoint, then query the ID with the expected target status and variable equality assertion. The reject request uses a static, non-sensitive automation reason. Do not add a case for an absent member record; the selection mechanism creates the skipped outcome.

Use `runId` as a safe initial run variable in `RunService.createQueuedRun` so the title interpolation is deterministic and no clock or credential enters case data.

- [ ] **Step 4: Run seed and full regression tests**

Run: `npm test -- tests/ark-community-cases.test.js tests/app.test.js tests/cms-api-runner.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit the persisted case library**

```bash
git add server/seed/ark-community-cases.js server/services/run-service.js tests/ark-community-cases.test.js tests/app.test.js
git commit -m "feat: seed community audit API chains"
```

### Task 5: Render outcome evidence and verify against the configured test environment

**Files:**
- Modify: `server/services/report-service.js`
- Test: `tests/app.test.js`
- Test: `tests/production-runner.test.js`

**Interfaces:**
- Consumes: run statuses and redacted `step.api` evidence persisted through the existing stores.
- Produces: HTML reports with passed, failed, and skipped totals; every API step renders the redacted decrypted request/response evidence.

- [ ] **Step 1: Write failing report tests**

```js
it('renders skipped cases separately from API failures in a batch report', () => {
  const report = renderBatchReport(batch, [passedRun, skippedRun, failedRun]);
  expect(report).toContain('前置数据不足');
  expect(report).toContain('1 跳过');
  expect(report).toContain('1 失败');
});

it('redacts secrets from skipped precondition evidence', () => {
  const report = renderReport({ ...skippedRun, steps: [{ api: { request: { token: 'secret' }, response: { token: 'secret' } } }] }, '审核用例');
  expect(report).not.toContain('secret');
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- tests/app.test.js tests/production-runner.test.js`

Expected: FAIL because reports only count passed and failed runs.

- [ ] **Step 3: Implement report outcome labels and counts**

Add a status label helper mapping `skipped` to `前置数据不足`. Use it in single and batch reports. In `renderBatchReport`, calculate `passed`, `failed`, and `skipped` independently and print all three counts. Preserve `redactTransportSecrets` and `redactBusinessSecrets` before HTML escaping, including evidence attached to skipped steps.

- [ ] **Step 4: Verify the complete application and controlled environment path**

Run: `npm test`

Expected: PASS.

Start the server only after confirming the runtime reports all required CMS environment variable names as configured. In the browser, confirm the seeded cases appear under “方舟社区发帖”; run read-only cases first; then explicitly confirm a small mutation batch. Inspect its batch report for local timestamps, masked sensitive values, decrypted business fields, one shared login session, and the correct pass/fail/skip conclusion. Stop immediately if the endpoint reports production identity or missing configuration.

- [ ] **Step 5: Commit report coverage**

```bash
git add server/services/report-service.js tests/app.test.js tests/production-runner.test.js
git commit -m "feat: report API precondition outcomes"
```

## Plan Self-Review

- Spec coverage: Tasks 1-2 implement dynamic ID selection, batch reuse, explicit authorization and non-failure preconditions. Task 3 makes the authorization visible and preserves editor data. Task 4 writes only non-delete assets. Task 5 completes report evidence and test-environment verification.
- Placeholder scan: no unresolved work markers, deferred implementation, or unspecified validation remains; every task has file paths, tests, implementation behavior, commands, and expected results.
- Consistency: `allowMutations`, `selectedApiIds`, `PRECONDITION_UNAVAILABLE`, `request.select`, and `skipped` are named uniformly from runner through HTTP, UI, persistence, and report.
