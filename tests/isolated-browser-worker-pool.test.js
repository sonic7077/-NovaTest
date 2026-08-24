import { describe, expect, it, vi } from 'vitest';
import { IsolatedBrowserWorkerPool } from '../server/services/isolated-browser-worker-pool.js';

describe('isolated browser worker pool', () => {
  it('creates one isolated worker for each account and reports the aggregate', async () => {
    const contexts = [];
    const pool = new IsolatedBrowserWorkerPool({
      workerFactory: async ({ workerId, account }) => {
        const context = { workerId, account };
        contexts.push(context);
        return { run: async () => ({ status: 'passed', messageCount: 10, image: { status: 'passed' } }), close: vi.fn() };
      }
    });

    const result = await pool.run([
      { workerId: 'w-1', account: { username: 'nt01' } },
      { workerId: 'w-2', account: { username: 'nt02' } }
    ]);

    expect(contexts.map((context) => context.account.username)).toEqual(['nt01', 'nt02']);
    expect(result).toMatchObject({ total: 2, passed: 2, failed: 0, timedOut: 0, messageCount: 20, imagePassed: 2 });
    expect(result.workers).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('Aa01');
  });

  it('does not exceed the configured concurrency', async () => {
    let active = 0;
    let peak = 0;
    const pool = new IsolatedBrowserWorkerPool({
      maxConcurrency: 2,
      workerFactory: async () => ({
        run: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { status: 'passed' };
        },
        close: async () => {}
      })
    });

    await pool.run(Array.from({ length: 5 }, (_, index) => ({ workerId: `w-${index + 1}` })));

    expect(peak).toBe(2);
  });

  it('isolates worker failures and always closes the worker', async () => {
    const closes = [];
    const pool = new IsolatedBrowserWorkerPool({
      workerFactory: async ({ workerId }) => ({
        run: async () => {
          if (workerId === 'bad') throw new Error('登录失败');
          return { status: 'passed' };
        },
        close: async () => { closes.push(workerId); }
      })
    });

    const result = await pool.run([{ workerId: 'bad' }, { workerId: 'good' }]);

    expect(result).toMatchObject({ total: 2, passed: 1, failed: 1 });
    expect(result.workers.find((worker) => worker.workerId === 'bad')).toMatchObject({ status: 'failed', error: '登录失败' });
    expect(closes).toEqual(expect.arrayContaining(['bad', 'good']));
  });

  it('marks a worker timed out and performs cleanup', async () => {
    const close = vi.fn();
    const pool = new IsolatedBrowserWorkerPool({
      workerTimeoutMs: 5,
      workerFactory: async () => ({ run: async () => new Promise(() => {}), close })
    });

    const result = await pool.run([{ workerId: 'slow' }]);

    expect(result).toMatchObject({ total: 1, passed: 0, failed: 1, timedOut: 1 });
    expect(result.workers[0]).toMatchObject({ workerId: 'slow', status: 'timedOut' });
    expect(close).toHaveBeenCalledOnce();
  });
});
