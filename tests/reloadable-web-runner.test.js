import { describe, expect, it, vi } from 'vitest';
import { createReloadableWebRunner } from '../server/services/reloadable-web-runner.js';

describe('reloadable Web runner', () => {
  it('keeps the active runner when replacement fails', async () => {
    const readyRunner = { execute: vi.fn(async () => ({ screenshot: 'before.png' })), finish: vi.fn() };
    const runner = createReloadableWebRunner({ current: readyRunner });

    await expect(runner.replace(Promise.reject(new Error('model unavailable')))).rejects.toThrow('model unavailable');
    await runner.execute({ id: 'step-1' }, {});

    expect(readyRunner.execute).toHaveBeenCalledOnce();
  });

  it('returns a stable snapshot for an in-progress run', async () => {
    const first = { execute: vi.fn(), finish: vi.fn() };
    const second = { execute: vi.fn(), finish: vi.fn() };
    const runner = createReloadableWebRunner({ current: first });
    const active = runner.snapshot();

    await runner.replace(second);
    await active.execute({ id: 'step-1' }, {});

    expect(first.execute).toHaveBeenCalledOnce();
    expect(second.execute).not.toHaveBeenCalled();
  });
});
