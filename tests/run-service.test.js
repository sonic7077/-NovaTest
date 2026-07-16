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
});
