import { describe, expect, it } from 'vitest';
import { RunService } from '../server/services/run-service.js';

const testCase = {
  id: 'case-1',
  name: '登录',
  target: 'web',
  baseUrl: 'https://example.test',
  viewport: 'desktop',
  steps: [{ id: 's1', kind: 'action', instruction: '点击登录' }]
};

describe('RunService', () => {
  it('retries a failed step once and records a passed result', async () => {
    let attempts = 0;
    const runner = {
      execute: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('not ready');
        return { screenshot: 'evidence/s1.png' };
      }
    };

    const run = await new RunService(runner).start(testCase);

    expect(run.status).toBe('passed');
    expect(run.steps[0]).toMatchObject({ id: 's1', status: 'passed', attempts: 2, screenshot: 'evidence/s1.png' });
    expect(run.steps[0].logs).toHaveLength(1);
  });

  it('stops the run after a step fails twice', async () => {
    const runner = { execute: async () => { throw new Error('element missing'); } };

    const run = await new RunService(runner).start(testCase);

    expect(run.status).toBe('failed');
    expect(run.steps[0]).toMatchObject({ status: 'failed', attempts: 2, error: 'element missing' });
  });

  it('keeps redacted API evidence when an API step fails', async () => {
    const error = new Error('API assertion failed: config');
    error.api = { action: 'config', request: { secret: '********' }, response: { status: 0 } };
    const runner = { api: { execute: async () => { throw error; } } };
    const apiCase = {
      ...testCase,
      target: 'api',
      steps: [{ id: 'config', kind: 'apiRequest', instruction: '读取配置', request: { action: 'config', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } }]
    };

    const run = await new RunService(runner).start(apiCase);

    expect(run.steps[0].api).toEqual(error.api);
  });

  it('passes the configured mobile viewport to the runner', async () => {
    let receivedContext;
    const mobileCase = { ...testCase, viewport: 'mobile' };
    const runner = { execute: async (_step, context) => { receivedContext = context; return {}; } };

    await new RunService(runner).start(mobileCase);

    expect(receivedContext.viewport).toEqual({ width: 390, height: 844 });
  });

  it('keeps one execution context across sequential Web UI steps', async () => {
    const contexts = [];
    const runner = { execute: async (_step, context) => { contexts.push(context); return {}; } };
    const multiStepCase = { ...testCase, steps: [testCase.steps[0], { id: 's2', kind: 'assert', instruction: '显示首页' }] };

    await new RunService(runner).start(multiStepCase);

    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toBe(contexts[1]);
  });

  it('keeps failed and passing evidence through one retry', async () => {
    let calls = 0;
    const runner = {
      execute: async (_step, context) => {
        calls += 1;
        expect(context.runId).toBeTypeOf('string');
        expect(context.attempt).toBe(calls);
        if (calls === 1) {
          const error = new Error('页面未就绪');
          error.evidence = { path: `${context.runId}/s1-attempt-1.png`, attempt: 1, phase: 'failed' };
          throw error;
        }
        return {
          screenshot: `${context.runId}/s1-attempt-2.png`,
          screenshots: [{ path: `${context.runId}/s1-attempt-2.png`, attempt: 2, phase: 'passed' }]
        };
      }
    };

    const run = await new RunService(runner).start(testCase);

    expect(run.steps[0]).toMatchObject({ screenshot: `${run.id}/s1-attempt-2.png` });
    expect(run.steps[0].screenshots).toEqual([
      { path: `${run.id}/s1-attempt-1.png`, attempt: 1, phase: 'failed' },
      { path: `${run.id}/s1-attempt-2.png`, attempt: 2, phase: 'passed' }
    ]);
  });

  it('selects the API runner for API test cases', async () => {
    let selected = false;
    const service = new RunService({
      web: { execute: async () => { throw new Error('wrong runner'); } },
      api: { execute: async () => { selected = true; return { api: { action: 'config' } }; } }
    });
    const apiCase = { ...testCase, target: 'api', steps: [{ id: 's1', kind: 'apiRequest', instruction: '读取配置', request: { action: 'config', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } }] };

    const run = await service.start(apiCase);

    expect(selected).toBe(true);
    expect(run.status).toBe('passed');
  });

  it('publishes queued, running, step and terminal snapshots', async () => {
    const updates = [];
    const service = new RunService({ execute: async () => ({}) });
    const queued = service.createQueuedRun(testCase);

    expect(queued).toMatchObject({ status: 'queued', startedAt: null, steps: [{ id: 's1', status: 'queued', attempts: 0 }] });

    await service.start(testCase, {
      run: queued,
      onUpdate: (run) => updates.push(structuredClone(run))
    });

    expect(updates.map((run) => run.status)).toEqual(['running', 'running', 'running', 'passed']);
    expect(updates[1].steps[0]).toMatchObject({ status: 'running', attempts: 1 });
    expect(updates.at(-1)).toMatchObject({ status: 'passed', finishedAt: expect.any(String) });
  });

  it('publishes retry and failed terminal snapshots', async () => {
    const updates = [];
    const service = new RunService({ execute: async () => { throw new Error('页面未就绪'); } });

    await service.start(testCase, {
      run: service.createQueuedRun(testCase),
      onUpdate: (run) => updates.push(structuredClone(run))
    });

    expect(updates.some((run) => run.steps[0].logs.some((log) => log.message.includes('retrying once')))).toBe(true);
    expect(updates.at(-1)).toMatchObject({ status: 'failed', steps: [{ status: 'failed', attempts: 2 }] });
  });
});
