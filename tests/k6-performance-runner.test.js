import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { K6PerformanceRunner } from '../server/runners/k6-performance-runner.js';

const asset = {
  id: 'asset-1',
  protocol: 'daygf',
  config: {
    baseUrl: 'https://daygf.example.test',
    dataset: { postIds: [101], historyContentIds: [201] },
    stages: [{ vus: 20, durationSeconds: 180 }],
    securityProbe: { enabled: false, postId: 999 }
  }
};

describe('k6 performance runner', () => {
  it('spawns k6 without a shell and keeps credentials out of progress samples', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'novatest-k6-runner-'));
    const onSample = vi.fn();
    const spawnImpl = vi.fn((_command, args) => {
      const child = new EventEmitter();
      child.kill = vi.fn();
      const summaryPath = args[args.indexOf('--summary-export') + 1];
      queueMicrotask(async () => {
        await writeFile(summaryPath, JSON.stringify({ metrics: {
          http_reqs: { values: { count: 12 } },
          http_req_failed: { values: { rate: 0 } },
          http_req_duration: { values: { 'p(95)': 310 } }
        } }));
        child.emit('close', 0);
      });
      return child;
    });
    const runner = new K6PerformanceRunner({ k6Path: 'k6', spawnImpl, temporaryDirectory });

    try {
      const result = await runner.run({
        runId: 'perf-1', asset,
        accounts: [{ username: 'vu-1', password: 'private-password' }],
        onSample
      });

      expect(spawnImpl).toHaveBeenCalledWith('k6', expect.arrayContaining(['run', '--summary-export']), expect.objectContaining({ shell: false }));
      expect(result.summary).toMatchObject({ requests: 12, failures: 0, p95Ms: 310 });
      expect(onSample).toHaveBeenCalledWith(expect.objectContaining({ requests: 12, failures: 0, p95Ms: 310 }));
      expect(JSON.stringify(onSample.mock.calls)).not.toContain('private-password');
      expect(await readdir(temporaryDirectory)).toEqual([]);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('fails explicitly when k6 is unavailable', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'novatest-k6-runner-'));
    const spawnImpl = vi.fn(() => {
      const child = new EventEmitter();
      child.kill = vi.fn();
      queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn k6 ENOENT'), { code: 'ENOENT' })));
      return child;
    });
    const runner = new K6PerformanceRunner({ k6Path: 'k6', spawnImpl, temporaryDirectory });

    try {
      await expect(runner.run({ runId: 'perf-2', asset, accounts: [{ username: 'vu-1', password: 'private-password' }] }))
        .rejects.toThrow('k6 is unavailable');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
