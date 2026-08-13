import { describe, expect, it, vi } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { ExecutionService } from '../server/services/execution-service.js';

const webCase = {
  id: 'case-1', projectId: 'default-project', name: '首页验证', target: 'web', baseUrl: 'https://example.test', viewport: 'desktop',
  steps: [{ id: 's1', kind: 'action', instruction: '打开首页' }]
};

const apiCases = ['config', 'list_post'].map((action, index) => ({
  id: `api-${index + 1}`, projectId: 'default-project', name: action, target: 'api', baseUrl: 'https://example.test/api.php', viewport: 'desktop',
  steps: [{ id: action, kind: 'apiRequest', instruction: action, request: { action, method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } }]
}));

async function waitForTerminal(store, id) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const task = store.getBatch(id) || store.getRun(id);
    if (['passed', 'failed'].includes(task?.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('execution did not finish');
}

describe('ExecutionService', () => {
  it('fixes batch case and step totals before any run is created', () => {
    const store = createMemoryStore();
    const service = new ExecutionService({ runner: {}, store, schedule: () => {} });
    const second = {
      ...webCase,
      id: 'case-2',
      steps: [...webCase.steps, { id: 's2', kind: 'action', instruction: '检查结果' }]
    };

    const batch = service.queueBatch({
      name: '固定总量', projectId: 'default-project', target: 'web',
      caseIds: [webCase.id, second.id], cases: [webCase, second]
    });

    expect(batch).toMatchObject({ plannedCaseCount: 2, plannedStepCount: 3, runIds: [] });
    expect(store.listExecutions().find((item) => item.id === batch.id))
      .toMatchObject({ totalCases: 2, totalSteps: 3, completedCases: 0, completedSteps: 0 });
  });

  it('returns a queued batch before a runner step resolves', async () => {
    const store = createMemoryStore();
    let release;
    const runner = { execute: () => new Promise((resolve) => { release = resolve; }) };
    const service = new ExecutionService({ runner, store });

    const batch = service.queueBatch({ name: '异步回归', projectId: 'default-project', target: 'web', caseIds: [webCase.id], cases: [webCase] });

    expect(batch).toMatchObject({ status: 'queued', runIds: [], startedAt: null, finishedAt: null });
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.getBatch(batch.id)).toMatchObject({ status: 'running' });
    release({});
    await expect(waitForTerminal(store, batch.id)).resolves.toMatchObject({ status: 'passed', runIds: [expect.any(String)] });
  });

  it('shares one API session and persists every batch run', async () => {
    const store = createMemoryStore();
    const api = { createSession: vi.fn(() => ({})), execute: vi.fn(async () => ({})) };
    const service = new ExecutionService({ runner: { api }, store });

    const batch = service.queueBatch({ name: '接口查询', projectId: 'default-project', target: 'api', caseIds: apiCases.map(({ id }) => id), cases: apiCases });

    await expect(waitForTerminal(store, batch.id)).resolves.toMatchObject({ status: 'passed', runIds: [expect.any(String), expect.any(String)] });
    expect(api.createSession).toHaveBeenCalledTimes(1);
    expect(api.execute).toHaveBeenCalledTimes(2);
  });

  it('marks a batch skipped when every API run lacks prerequisite data', async () => {
    const store = createMemoryStore();
    const api = {
      createSession: () => ({}),
      execute: async () => { throw Object.assign(new Error('前置数据不足'), { code: 'PRECONDITION_UNAVAILABLE' }); }
    };
    const service = new ExecutionService({ runner: { api }, store });
    const batch = service.queueBatch({ name: '审核前置检查', projectId: 'default-project', target: 'api', caseIds: apiCases.map(({ id }) => id), cases: apiCases });

    for (let attempt = 0; attempt < 50 && store.getBatch(batch.id).status !== 'skipped'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    expect(store.getBatch(batch.id)).toMatchObject({ status: 'skipped' });
    expect(store.getBatch(batch.id).runIds.map((id) => store.getRun(id).status)).toEqual(['skipped', 'skipped']);
  });

  it('persists requested mutation authorization before scheduling a run', () => {
    const store = createMemoryStore();
    const service = new ExecutionService({ runner: { execute: async () => ({}) }, store, schedule: () => {} });

    const run = service.queueRun(webCase, { allowMutations: true });

    expect(run).toMatchObject({ status: 'queued', allowMutations: true });
    expect(store.getRun(run.id)).toMatchObject({ allowMutations: true });
  });

  it('resolves a Web UI case project before executing it', async () => {
    const store = createMemoryStore();
    store.saveProject({ id: 'default-project', name: '默认项目', webAuth: { provider: 'lighthouse', host: 'dt.chenmoyuan.tech' } });
    let receivedProject;
    const service = new ExecutionService({
      runner: { web: { execute: async (_step, context) => { receivedProject = context.project; return {}; }, finish: async () => {} } },
      store,
      schedule: () => {}
    });
    const run = service.queueRun(webCase);

    await service.executeRun(webCase, run);

    expect(receivedProject.webAuth).toEqual({ provider: 'lighthouse', host: 'dt.chenmoyuan.tech' });
  });
});
