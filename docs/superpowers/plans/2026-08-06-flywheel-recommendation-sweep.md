# 飞轮推荐兴趣遍历实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 `server/seed/flywheel-taxonomy.json` 生成 10 组独立飞轮推荐策略用例，每组请求 20 条内容并要求实际返回 10～20 条，批量执行时失败不中断且在汇总报告中保留每组分析证据。

**Architecture:** 扩展现有 `FlywheelApiRunner` 的策略校验与稳定抽样能力；在现有飞轮种子文件中保留第 1 组并生成第 2～10 组，同一批次继续复用现有 `BatchService`、`RunService` 与报告渲染，不增加表或新执行器。

**Tech Stack:** Node.js ESM、Vitest、现有 SQLite/file store、原生 `fetch`。

## Global Constraints

- 所有推荐请求使用 `size=20`。
- 每组推荐响应条数必须满足 `minItems=10` 且 `maxItems=20`。
- 每组兴趣从 taxonomy 82 个标签中稳定抽取 1～3 个，组间使用不同 `salt`。
- 继续校验前 2 条命中、命中率下限 0.3、命中率上限 0.8、`content_id` 唯一。
- 不新增删除、对账或 taxonomy 导入线上词表的调用。
- 不修改当前工作区已有 Web UI/Lighthouse 未提交文件。

---

### Task 1: 扩展推荐策略门槛与分组抽样

**Files:**
- Modify: `server/domain/case.js` (`validRecommendationPolicy`)
- Modify: `server/runners/flywheel-api-runner.js` (`selectRandomValues`, `recommendationAnalysis`)
- Test: `tests/case.test.js`
- Test: `tests/flywheel-api-runner.test.js`

**Interfaces:**
- `recommendationPolicy.minItems`: integer 1..50, required only when provided; analysis fails when `itemCount < minItems`.
- `randomSelection.salt`: optional non-empty string; stable seed is derived from `runId` and salt.

- [ ] **Step 1: Write failing tests**

Add to `tests/case.test.js`:

```js
it('validates a minimum recommendation item threshold', () => {
  const request = { protocol: 'flywheel', action: '/api/v1/feed', method: 'GET', payload: {}, expectedStatus: 200, safety: 'readonly', recommendationPolicy: {
    selectedTagsVariable: 'selectedInterests', requestedSize: 20, minItems: 10, maxItems: 20,
    headGuard: 2, minHitRatio: 0.3, maxHitRatio: 0.8, requireUniqueContentIds: true
  } };
  const testCase = validateWebCase({ id: 'minimum-feed', projectId: 'p', name: '推荐数量', target: 'api', baseUrl: 'https://flywheel.example.test', viewport: 'desktop', steps: [{ id: 'feed', kind: 'apiRequest', instruction: '读取推荐', request }] });
  expect(testCase.steps[0].request.recommendationPolicy.minItems).toBe(10);
  expect(() => validateWebCase({ ...testCase, steps: [{ ...testCase.steps[0], request: { ...request, recommendationPolicy: { ...request.recommendationPolicy, minItems: 0 } } }] })).toThrow('invalid API request');
});
```

Add to `tests/flywheel-api-runner.test.js`:

```js
it('fails recommendation analysis when fewer than minItems are returned', async () => {
  const runner = new FlywheelApiRunner({ config, fetchImpl: async () => response(200, { items: recommendationItems(['热门', '热门', '最新', '探索', '探索', '探索', '探索', '探索', '探索'], 9) }) });
  await expect(runner.execute(step('/api/v1/feed', { recommendationPolicy: { ...policy(), minItems: 10 } }), {
    testCase: { baseUrl: config.baseUrl }, variables: { selectedInterests: ['热门', '最新'] }
  })).rejects.toMatchObject({ message: expect.stringContaining('at least 10') });
});

it('uses a different deterministic interest combination for different salts', async () => {
  const runner = new FlywheelApiRunner({ config, fetchImpl: async () => response(200, { ok: true }) });
  const request = { method: 'PUT', safety: 'mutating', payload: { onboarding_tags: '{{selectedInterests}}' }, randomSelection: { variable: 'selectedInterests', values: ['热门', '最新', '精选', '偷拍'], minCount: 1, maxCount: 3 } };
  const selected = [];
  for (const salt of ['group-01', 'group-02']) selected.push((await runner.execute(step('/api/v1/users/u', { ...request, randomSelection: { ...request.randomSelection, salt } }), { testCase: { baseUrl: config.baseUrl }, variables: { runId: 'same' }, allowMutations: true })).variables.selectedInterests);
  expect(selected[0]).not.toEqual(selected[1]);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run `npm test -- --run tests/case.test.js tests/flywheel-api-runner.test.js`. Expected: the new minimum threshold and salt tests fail because the fields are not implemented.

- [ ] **Step 3: Implement minimal behavior**

In `server/domain/case.js`, validate `minItems` as an optional integer 1..50 and require `minItems <= maxItems` when both exist. In `server/runners/flywheel-api-runner.js`, append `selection.salt` to the stable seed input, include `minItems` in analysis, and add a hard failure message `recommendation response has ${itemCount} items, at least ${policy.minItems} required`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run `npm test -- --run tests/case.test.js tests/flywheel-api-runner.test.js`; expected all tests in both files pass.

- [ ] **Step 5: Commit**

Run `git add server/domain/case.js server/runners/flywheel-api-runner.js tests/case.test.js tests/flywheel-api-runner.test.js && git commit -m "feat: enforce flywheel recommendation minimum"`.

### Task 2: Seed ten taxonomy-driven recommendation cases

**Files:**
- Modify: `server/seed/flywheel-cases.js`
- Test: `tests/flywheel-cases.test.js`

**Interfaces:**
- `flywheelCases({ projectId, baseUrl, platformId })` returns the existing cases plus exactly nine additional cases with IDs `flywheel-recommendation-policy-02` through `-10`.

- [ ] **Step 1: Write failing seed tests**

Assert that ten cases have IDs matching `flywheel-recommendation-policy(-0[1-9]|-10)?`, each has two steps, feed payload `size: 20`, policy `minItems: 10`, and random selections have distinct salts `group-01` through `group-10`.

- [ ] **Step 2: Run `npm test -- --run tests/flywheel-cases.test.js` and verify RED**

Expected: only the original case exists and `minItems`/additional groups are missing.

- [ ] **Step 3: Implement the group factory**

Extract the current two-step recommendation case into a local `recommendationPolicyCase(groupIndex)` helper. Keep group 1 ID/name unchanged for compatibility; use `flywheel-recommendation-policy-${String(groupIndex).padStart(2, '0')}` and `正例：飞轮推荐策略-兴趣组${String(groupIndex).padStart(2, '0')}/10` for groups 2..10. Set `salt: group-${String(groupIndex).padStart(2, '0')}`, `minItems: 10`, and reuse the imported taxonomy list. Insert all ten cases before event cases.

- [ ] **Step 4: Run the seed tests and verify GREEN**

Run `npm test -- --run tests/flywheel-cases.test.js`; expected all seed assertions pass and existing case count assertions remain valid.

- [ ] **Step 5: Commit**

Run `git add server/seed/flywheel-cases.js tests/flywheel-cases.test.js && git commit -m "feat: seed ten flywheel recommendation groups"`.

### Task 3: Regression and real batch verification

**Files:**
- Modify only if needed after test evidence: `server/runners/flywheel-api-runner.js`, `server/seed/flywheel-cases.js`, or their tests.
- Generated runtime data: SQLite/data package only; do not stage it.

- [ ] **Step 1: Run full regression**

Run `npm test -- --run`. Expected: all existing and new tests pass with zero failures.

- [ ] **Step 2: Restart the local service on port 4173**

Stop any stale process bound to 4173, start the existing server command, and verify `GET http://127.0.0.1:4173/api/projects` returns HTTP 200. Do not start a second competing port.

- [ ] **Step 3: Verify SQLite reseeding**

Query the API project list and case list for project `9115e7b7-8607-4343-941d-72d612cdb6ef`; verify ten recommendation group cases exist and their names/salts are present in stored step JSON.

- [ ] **Step 4: Execute the ten groups as one authorized batch**

Use the existing batch endpoint with only the ten recommendation case IDs and `allowMutations: true`. Poll the batch until terminal status. Confirm an individual group failure does not prevent later groups from obtaining run IDs.

- [ ] **Step 5: Inspect the aggregate report**

Open the batch report and verify each group displays selected interests, response count, hit ratio, item tag evidence, and failure reason when applicable. Confirm platform key is redacted from serialized request/response evidence.

- [ ] **Step 6: Package data**

Run `npm run package:data`; verify the generated archive contains the SQLite database and a deployment README, and leave the archive untracked unless the user explicitly requests committing it.

