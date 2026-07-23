# Web UI 智能执行 MVP 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将静态测试控制台升级为可创建、运行和查看 Web UI 自然语言测试任务的本地 MVP。

**Architecture:** Node HTTP 服务持有用例和任务状态，按依赖注入的 Web 执行器运行步骤。生产执行器将 Playwright 页面与 Midscene Agent 组合，测试执行器为可控的假实现；静态前端通过 REST API 保存用例、发起任务并轮询报告。

**Tech Stack:** Node.js 20+、Express、Vitest、Playwright、`@midscene/web`、原生 HTML/CSS/JavaScript。

## Global Constraints

- 执行目标仅为 `web`，以 `desktop`（1440x900）和 `mobile`（390x844）视口运行。
- Web 动作、断言与查询必须分别映射到 `aiAct`、`aiAssert`、`aiQuery`。
- 每个步骤保留状态、耗时、日志与截图路径；失败步骤只重试一次。
- 未配置 `MIDSCENE_MODEL_BASE_URL`、`MIDSCENE_MODEL_API_KEY`、`MIDSCENE_MODEL_NAME`、`MIDSCENE_MODEL_FAMILY` 时，返回明确的配置错误。
- 测试不得调用真实模型、浏览器或网络目标。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `package.json` | 本地启动、测试与依赖声明。 |
| `server/app.js` | Express 应用与 REST 路由装配。 |
| `server/domain/case.js` | 用例校验与变量替换。 |
| `server/domain/run.js` | 任务、步骤结果与状态定义。 |
| `server/services/run-service.js` | 执行流程、状态更新和单步重试。 |
| `server/runners/web-runner.js` | Playwright/Midscene 生产适配器。 |
| `server/services/report-service.js` | JSON 与 HTML 报告生成。 |
| `server/storage/file-store.js` | `data/` 下的本地 JSON 持久化。 |
| `tests/*.test.js` | 与领域边界一一对应的 Vitest 测试。 |
| `index.html`、`app.js`、`style.css` | Web UI 测试用例编辑、运行状态与报告展示。 |

### Task 1: 建立可测试的 Web 用例领域模型

**Files:**
- Create: `package.json`
- Create: `server/domain/case.js`
- Create: `tests/case.test.js`

**Interfaces:**
- Produces: `validateWebCase(input): TestCase`、`interpolate(value, variables): unknown`。
- Consumes: 无。

- [ ] **Step 1: 写入失败测试**

```js
import { describe, expect, it } from 'vitest';
import { interpolate, validateWebCase } from '../server/domain/case.js';

it('accepts a desktop web case with natural language steps', () => {
  expect(validateWebCase({ name: '登录', target: 'web', baseUrl: 'https://example.test', viewport: 'desktop', steps: [{ id: 's1', kind: 'action', instruction: '点击登录' }] }).target).toBe('web');
});

it('replaces variables recursively and rejects a missing variable', () => {
  expect(interpolate('订单 {{orderId}}', { orderId: 'A-1' })).toBe('订单 A-1');
  expect(() => interpolate('{{missing}}', {})).toThrow('missing');
});
```

- [ ] **Step 2: 确认测试失败**

Run: `npm test -- tests/case.test.js`

Expected: FAIL，模块 `server/domain/case.js` 不存在。

- [ ] **Step 3: 实现最小领域代码**

```js
export function validateWebCase(input) {
  if (!input?.name || input.target !== 'web' || !/^https?:\/\//.test(input.baseUrl || '')) throw new Error('invalid web case');
  if (!['desktop', 'mobile'].includes(input.viewport)) throw new Error('invalid viewport');
  if (!Array.isArray(input.steps) || input.steps.length === 0) throw new Error('steps required');
  return input;
}

export function interpolate(value, variables) {
  if (typeof value !== 'string') return value;
  return value.replace(/{{\s*([\w.-]+)\s*}}/g, (_, name) => {
    if (!(name in variables)) throw new Error(`missing variable: ${name}`);
    return String(variables[name]);
  });
}
```

- [ ] **Step 4: 确认领域测试通过**

Run: `npm test -- tests/case.test.js`

Expected: PASS，2 tests passed。

- [ ] **Step 5: 提交任务**

```bash
git add package.json server/domain/case.js tests/case.test.js
git commit -m "feat: add web test case domain"
```

### Task 2: 以可注入执行器实现任务状态和重试

**Files:**
- Create: `server/domain/run.js`
- Create: `server/services/run-service.js`
- Create: `tests/run-service.test.js`

**Interfaces:**
- Consumes: `validateWebCase()`、`interpolate()`。
- Produces: `RunService.start(testCase): Promise<Run>`，运行器合约 `execute(step, context): Promise<{ variables?: object, screenshot?: string }>`。

- [ ] **Step 1: 写入失败测试**

```js
it('retries a failed step once and records a passed result', async () => {
  let attempts = 0;
  const runner = { execute: async () => { attempts += 1; if (attempts === 1) throw new Error('not ready'); return { screenshot: 'evidence/s1.png' }; } };
  const service = new RunService(runner);
  const run = await service.start(caseWithOneAction);
  expect(run.status).toBe('passed');
  expect(run.steps[0].attempts).toBe(2);
});
```

- [ ] **Step 2: 确认测试失败**

Run: `npm test -- tests/run-service.test.js`

Expected: FAIL，`RunService` 未定义。

- [ ] **Step 3: 实现最小任务服务**

```js
export class RunService {
  constructor(runner) { this.runner = runner; }
  async start(testCase) {
    const run = { id: crypto.randomUUID(), status: 'running', variables: {}, steps: [] };
    for (const step of testCase.steps) {
      const result = { id: step.id, status: 'running', attempts: 0, logs: [] };
      run.steps.push(result);
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        result.attempts = attempt;
        try { Object.assign(run.variables, (await this.runner.execute({ ...step, instruction: interpolate(step.instruction, run.variables) }, run)).variables); result.status = 'passed'; break; }
        catch (error) { result.error = error.message; result.status = 'failed'; }
      }
      if (result.status === 'failed') { run.status = 'failed'; return run; }
    }
    run.status = 'passed'; return run;
  }
}
```

- [ ] **Step 4: 确认任务服务测试通过**

Run: `npm test -- tests/run-service.test.js`

Expected: PASS，重试两次且任务通过。

- [ ] **Step 5: 提交任务**

```bash
git add server/domain/run.js server/services/run-service.js tests/run-service.test.js
git commit -m "feat: add web run orchestration"
```

### Task 3: 增加 Playwright 和 Midscene Web 执行适配器

**Files:**
- Create: `server/runners/web-runner.js`
- Create: `tests/web-runner.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: 步骤 `kind` 为 `action`、`assert`、`query`。
- Produces: `createWebRunner({ browser, agentFactory, screenshotDir }): { execute }`。

- [ ] **Step 1: 写入失败测试**

```js
it('maps action, assert and query to the matching agent method', async () => {
  const calls = [];
  const runner = createWebRunner({ browser: fakeBrowser, agentFactory: () => ({ aiAct: async v => calls.push(['act', v]), aiAssert: async v => calls.push(['assert', v]), aiQuery: async () => ({ orderId: 'A-1' }) }) });
  await runner.execute({ kind: 'action', instruction: '打开首页' }, {});
  await runner.execute({ kind: 'assert', instruction: '显示标题' }, {});
  expect((await runner.execute({ kind: 'query', instruction: '提取订单号' }, {})).variables).toEqual({ orderId: 'A-1' });
  expect(calls).toEqual([['act', '打开首页'], ['assert', '显示标题']]);
});
```

- [ ] **Step 2: 确认测试失败**

Run: `npm test -- tests/web-runner.test.js`

Expected: FAIL，`createWebRunner` 未定义。

- [ ] **Step 3: 实现最小适配器**

```js
export function createWebRunner({ browser, agentFactory, screenshotDir }) {
  return { async execute(step, context) {
    const page = context.page ?? await browser.newPage({ viewport: context.viewport });
    context.page = page;
    const agent = agentFactory(page);
    if (step.kind === 'action') await agent.aiAct(step.instruction);
    if (step.kind === 'assert') await agent.aiAssert(step.instruction);
    const variables = step.kind === 'query' ? await agent.aiQuery(step.instruction) : undefined;
    const screenshot = await page.screenshot({ path: `${screenshotDir}/${step.id}.png` });
    return { variables, screenshot };
  }};
}
```

- [ ] **Step 4: 确认适配器测试通过**

Run: `npm test -- tests/web-runner.test.js`

Expected: PASS，三个步骤类型均按契约映射。

- [ ] **Step 5: 提交任务**

```bash
git add package.json server/runners/web-runner.js tests/web-runner.test.js
git commit -m "feat: add midscene web runner"
```

### Task 4: 提供任务 API 与报告

**Files:**
- Create: `server/app.js`
- Create: `server/services/report-service.js`
- Create: `server/storage/file-store.js`
- Create: `tests/app.test.js`

**Interfaces:**
- Consumes: `RunService.start(testCase)`。
- Produces: `POST /api/cases`、`POST /api/cases/:id/runs`、`GET /api/runs/:id`、`GET /api/runs/:id/report`。

- [ ] **Step 1: 写入失败 API 测试**

```js
it('creates a web case, starts a run and returns its report', async () => {
  const app = createApp({ runner: passingRunner, store: memoryStore });
  const created = await request(app).post('/api/cases').send(webCase).expect(201);
  const run = await request(app).post(`/api/cases/${created.body.id}/runs`).expect(202);
  await request(app).get(`/api/runs/${run.body.id}`).expect(200).expect(r => expect(r.body.status).toBe('passed'));
  await request(app).get(`/api/runs/${run.body.id}/report`).expect(200).expect('content-type', /html/);
});
```

- [ ] **Step 2: 确认测试失败**

Run: `npm test -- tests/app.test.js`

Expected: FAIL，应用模块不存在。

- [ ] **Step 3: 实现路由和报告服务**

```js
app.post('/api/cases', (req, res) => res.status(201).json(store.saveCase(validateWebCase(req.body))));
app.post('/api/cases/:id/runs', async (req, res) => { const run = await runService.start(store.getCase(req.params.id)); store.saveRun(run); res.status(202).json(run); });
app.get('/api/runs/:id', (req, res) => res.json(store.getRun(req.params.id)));
app.get('/api/runs/:id/report', (req, res) => res.type('html').send(renderReport(store.getRun(req.params.id))));
```

- [ ] **Step 4: 确认 API 与报告测试通过**

Run: `npm test -- tests/app.test.js`

Expected: PASS，HTTP 状态分别为 201、202、200、200。

- [ ] **Step 5: 提交任务**

```bash
git add server tests/app.test.js
git commit -m "feat: add web test execution api"
```

### Task 5: 将控制台切换为 Web UI 真实执行体验

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`
- Create: `tests/frontend-smoke.test.js`

**Interfaces:**
- Consumes: `POST /api/cases` 和 `POST /api/cases/:id/runs`。
- Produces: Web UI 用例 JSON、状态轮询和报告链接。

- [ ] **Step 1: 写入失败前端冒烟测试**

```js
it('serializes Web UI desktop steps and sends them to the cases API', async () => {
  document.body.innerHTML = fixture;
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'case-1' }) });
  await saveCase();
  expect(fetch).toHaveBeenCalledWith('/api/cases', expect.objectContaining({ method: 'POST' }));
});
```

- [ ] **Step 2: 确认测试失败**

Run: `npm test -- tests/frontend-smoke.test.js`

Expected: FAIL，`saveCase` 未导出。

- [ ] **Step 3: 用真实数据流替换模拟 UI**

```js
export async function saveCase() {
  const response = await fetch('/api/cases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(readCaseFromForm()) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function runCase() {
  const testCase = await saveCase();
  const run = await fetch(`/api/cases/${testCase.id}/runs`, { method: 'POST' }).then(r => r.json());
  return pollRun(run.id);
}
```

将目标标签替换为 `Web UI` 与 `API 服务`，增加 desktop/mobile 分段控件；删除 ADB、Android 和 H5 独立目标文本。轮询期间将返回的步骤状态和日志渲染到现有右侧执行面板，报告按钮链接到 `/api/runs/:id/report`。

- [ ] **Step 4: 确认前端测试和生产构建通过**

Run: `npm test && npm run start -- --help`

Expected: 所有 Vitest 测试通过，启动命令能输出服务监听信息。

- [ ] **Step 5: 用浏览器验证主路径并提交**

Run: `npm run start`

Expected: 在 `http://127.0.0.1:4173` 创建 Web desktop 用例，点击运行后显示轮询状态和报告链接。

```bash
git add index.html app.js style.css tests/frontend-smoke.test.js
git commit -m "feat: connect web ui test console"
```

## 计划自检

- 规格覆盖：Web desktop/mobile、自然语言步骤、Midscene 映射、重试、报告、前端轮询均有任务承接；API 执行器被明确延后。
- 占位符检查：未使用 TBD、TODO 或“适当处理”等不可执行描述。
- 类型一致性：`TestCase`、`RunService.start`、`createWebRunner.execute` 与前端 API 路由在各任务中使用同一命名。
