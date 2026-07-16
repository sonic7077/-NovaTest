import { describe, expect, it } from 'vitest';
import { createWebRunner } from '../server/runners/web-runner.js';

describe('web runner', () => {
  it('maps action, assert and query to the matching agent method', async () => {
    const calls = [];
    const screenshots = [];
    const browser = {
      newPage: async () => ({
        screenshot: async ({ path }) => { screenshots.push(path); return path; }
      })
    };
    const agentFactory = () => ({
      aiAct: async (instruction) => calls.push(['act', instruction]),
      aiAssert: async (instruction) => calls.push(['assert', instruction]),
      aiQuery: async (instruction) => { calls.push(['query', instruction]); return { orderId: 'A-1' }; }
    });
    const runner = createWebRunner({ browser, agentFactory, screenshotDir: 'evidence' });
    const context = { viewport: { width: 1440, height: 900 } };

    await runner.execute({ id: 's1', kind: 'action', instruction: '打开首页' }, context);
    await runner.execute({ id: 's2', kind: 'assert', instruction: '显示标题' }, context);
    const queryResult = await runner.execute({ id: 's3', kind: 'query', instruction: '提取订单号' }, context);

    expect(calls).toEqual([['act', '打开首页'], ['assert', '显示标题'], ['query', '提取订单号']]);
    expect(queryResult.variables).toEqual({ orderId: 'A-1' });
    expect(screenshots).toEqual(['evidence/s1.png', 'evidence/s2.png', 'evidence/s3.png']);
  });

  it('rejects an unsupported Web UI step kind', async () => {
    const runner = createWebRunner({ browser: {}, agentFactory: () => ({}) });

    await expect(runner.execute({ id: 's1', kind: 'apiRequest', instruction: 'request' }, {})).rejects.toThrow('unsupported web step kind');
  });

  it('opens the test case base URL before the first step', async () => {
    const navigations = [];
    const page = { goto: async (url) => navigations.push(url), screenshot: async () => 'evidence/s1.png' };
    const runner = createWebRunner({
      browser: { newPage: async () => page },
      agentFactory: () => ({ aiAct: async () => {} })
    });

    await runner.execute({ id: 's1', kind: 'action', instruction: '开始' }, { testCase: { baseUrl: 'https://example.test' } });

    expect(navigations).toEqual(['https://example.test']);
  });
});
