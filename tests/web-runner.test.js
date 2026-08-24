import { describe, expect, it, vi } from 'vitest';
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

  it('runs shared login once before the first Web UI case step and closes the session on finish', async () => {
    const calls = [];
    const close = vi.fn();
    const page = { goto: async () => calls.push('goto'), screenshot: async () => undefined };
    const runner = createWebRunner({
      browser: { openPage: async () => ({ page, close }) },
      agentFactory: () => ({ aiAct: async () => calls.push('act') }),
      beforeFirstStep: async () => calls.push('login')
    });
    const context = { testCase: { baseUrl: 'https://example.test' } };

    await runner.execute({ id: 's1', kind: 'action', instruction: '第一步' }, context);
    await runner.execute({ id: 's2', kind: 'action', instruction: '第二步' }, context);
    await runner.finish(context);
    await runner.finish(context);

    expect(calls).toEqual(['goto', 'login', 'act', 'act']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('creates a worker runner with an isolated session and defers context cleanup until worker close', async () => {
    const calls = [];
    const close = vi.fn();
    const session = { page: { goto: async () => calls.push('goto'), screenshot: async () => undefined }, close };
    const runner = createWebRunner({
      browser: { openContext: async () => session },
      agentFactory: () => ({ aiAct: async () => calls.push('act') })
    });
    const worker = await runner.createWorker({ viewport: { width: 1440, height: 900 } });

    await worker.execute({ id: 's1', kind: 'action', instruction: '执行任务' }, { testCase: { baseUrl: 'https://example.test' } });
    await worker.execute({ id: 's2', kind: 'action', instruction: '继续任务' }, { testCase: { baseUrl: 'https://example.test' } });
    await worker.finish({});

    expect(calls).toEqual(['goto', 'act', 'act']);
    expect(close).not.toHaveBeenCalled();
    await worker.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('reopens a clean session when shared login fails before a retried step', async () => {
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    const pages = [
      { goto: async () => {}, screenshot: async () => undefined },
      { goto: async () => {}, screenshot: async () => undefined }
    ];
    const openPage = vi.fn()
      .mockResolvedValueOnce({ page: pages[0], close: closeFirst })
      .mockResolvedValueOnce({ page: pages[1], close: closeSecond });
    let logins = 0;
    const runner = createWebRunner({
      browser: { openPage },
      agentFactory: () => ({ aiAct: async () => {} }),
      beforeFirstStep: async () => {
        logins += 1;
        if (logins === 1) throw new Error('login unavailable');
      }
    });
    const context = { testCase: { baseUrl: 'https://example.test' } };
    const step = { id: 's1', kind: 'action', instruction: '确认列表' };

    await expect(runner.execute(step, context)).rejects.toThrow('login unavailable');
    await expect(runner.execute(step, context)).resolves.toMatchObject({ screenshot: 's1.png' });

    expect(logins).toBe(2);
    expect(openPage).toHaveBeenCalledTimes(2);
    expect(closeFirst).toHaveBeenCalledTimes(1);
    await runner.finish(context);
    expect(closeSecond).toHaveBeenCalledTimes(1);
  });

  it('attaches failed screenshot evidence when shared login fails before the first step', async () => {
    const screenshots = [];
    const page = {
      goto: async () => {},
      screenshot: async ({ path }) => { screenshots.push(path); return path; }
    };
    const runner = createWebRunner({
      browser: { openPage: async () => ({ page, close: async () => {} }) },
      agentFactory: () => ({ aiAct: async () => {} }),
      beforeFirstStep: async () => { throw new Error('Lighthouse login failed'); },
      screenshotDir: 'evidence'
    });

    await expect(runner.execute(
      { id: 'verify-task-list', kind: 'action', instruction: '确认任务列表' },
      { runId: 'run-1', attempt: 1, testCase: { baseUrl: 'https://example.test' } }
    )).rejects.toMatchObject({
      message: 'Lighthouse login failed',
      evidence: { path: 'run-1/verify-task-list-attempt-1.png', attempt: 1, phase: 'failed' }
    });
    expect(screenshots).toEqual(['evidence/run-1/verify-task-list-attempt-1.png']);
  });

  it('writes success evidence to its run directory', async () => {
    const screenshots = [];
    const runner = createWebRunner({
      browser: { newPage: async () => ({ screenshot: async ({ path }) => { screenshots.push(path); return path; } }) },
      agentFactory: () => ({ aiAct: async () => {} }),
      screenshotDir: 'evidence'
    });

    const result = await runner.execute(
      { id: 's1', kind: 'action', instruction: '打开首页' },
      { runId: 'run-1', attempt: 2, viewport: { width: 1440, height: 900 } }
    );

    expect(screenshots).toEqual(['evidence/run-1/s1-attempt-2.png']);
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

  it('passes step reference images to Midscene and records semantic visual checks', async () => {
    const calls = [];
    const runner = createWebRunner({
      browser: { newPage: async () => ({ screenshot: async () => undefined }) },
      agentFactory: () => ({
        aiAct: async (prompt) => calls.push(['act', prompt]),
        aiAssert: async (prompt) => { calls.push(['assert', prompt]); return { pass: true, thought: '任务列表与参考状态一致' }; }
      }),
      resolveAssetPath: (assetPath) => `/safe/${assetPath}`
    });
    const result = await runner.execute({
      id: 's1', kind: 'action', instruction: '打开任务列表',
      visualChecks: [{ id: 'v1', assetPath: 'case-1/ref.png', source: 'upload', description: '任务列表已加载' }]
    }, { viewport: { width: 1440, height: 900 } });

    expect(calls).toEqual([
      ['act', expect.objectContaining({ prompt: expect.stringContaining('辅助识别'), images: [{ name: '参考图片 1', url: '/safe/case-1/ref.png' }], convertHttpImage2Base64: true })],
      ['assert', expect.objectContaining({ prompt: expect.stringContaining('任务列表已加载'), images: [{ name: '参考图片 1', url: '/safe/case-1/ref.png' }], convertHttpImage2Base64: true })]
    ]);
    expect(result.visualChecks).toEqual([{ id: 'v1', status: 'passed', reason: '任务列表与参考状态一致', baselinePath: 'case-1/ref.png', screenshot: 's1.png' }]);
  });

  it('treats action images as auxiliary recognition context', async () => {
    const calls = [];
    const runner = createWebRunner({
      browser: { newPage: async () => ({ screenshot: async () => undefined }) },
      agentFactory: () => ({
        aiAct: async (prompt) => calls.push(prompt),
        aiAssert: async () => ({ pass: true })
      }),
      resolveAssetPath: () => '/safe/case-1/reference.png'
    });

    await runner.execute({
      id: 's1', kind: 'action', instruction: '点击新建任务',
      visualChecks: [{ id: 'v1', assetPath: 'case-1/reference.png', source: 'upload', description: '新建任务按钮可见' }]
    }, { viewport: { width: 1440, height: 900 } });

    expect(calls[0]).toMatchObject({
      prompt: expect.stringContaining('辅助识别'),
      images: [{ name: '参考图片 1', url: '/safe/case-1/reference.png' }]
    });
  });

  it('treats assertion images as expected result evidence', async () => {
    const calls = [];
    const runner = createWebRunner({
      browser: { newPage: async () => ({ screenshot: async () => undefined }) },
      agentFactory: () => ({ aiAssert: async (prompt) => { calls.push(prompt); return { pass: true }; } }),
      resolveAssetPath: () => '/safe/case-1/reference.png'
    });

    await runner.execute({
      id: 's1', kind: 'assert', instruction: '确认任务创建成功',
      visualChecks: [{ id: 'v1', assetPath: 'case-1/reference.png', source: 'upload', description: '任务标题和清单正确' }]
    }, { viewport: { width: 1440, height: 900 } });

    expect(calls[0]).toMatchObject({
      prompt: expect.stringContaining('预期结果'),
      images: [{ name: '参考图片 1', url: '/safe/case-1/reference.png' }]
    });
  });

  it('preserves visual check failure details with a failed screenshot', async () => {
    const runner = createWebRunner({
      browser: { newPage: async () => ({ screenshot: async () => undefined }) },
      agentFactory: () => ({ aiAct: async () => {}, aiAssert: async () => ({ pass: false, message: '未找到新任务标题' }) }),
      resolveAssetPath: () => '/safe/case-1/ref.png'
    });

    await expect(runner.execute({
      id: 's1', kind: 'action', instruction: '创建任务',
      visualChecks: [{ id: 'v1', assetPath: 'case-1/ref.png', source: 'upload', description: '任务创建成功' }]
    }, { runId: 'run-1', attempt: 1, viewport: { width: 1440, height: 900 } })).rejects.toMatchObject({
      message: '未找到新任务标题',
      visualChecks: [{ id: 'v1', status: 'failed', reason: '未找到新任务标题', baselinePath: 'case-1/ref.png', screenshot: 'run-1/s1-attempt-1.png' }],
      evidence: { path: 'run-1/s1-attempt-1.png', attempt: 1, phase: 'failed' }
    });
  });
});
