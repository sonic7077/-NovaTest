import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { createSqliteStore } from '../server/storage/sqlite-store.js';

describe('performance SQLite store', () => {
  it('keeps the same redacted account-pool contract in memory', () => {
    const store = createMemoryStore();
    const project = store.saveProject({ name: '内存性能项目' });
    const pool = store.savePerformanceAccountPool({ id: 'pool-memory', projectId: project.id, name: '账号池', accounts: [{ username: 'vu-01', password: 'private-password' }] });

    expect(pool).toMatchObject({ id: 'pool-memory', accountCount: 1 });
    expect(JSON.stringify(pool)).not.toContain('private-password');
    expect(store.getPerformanceAccountPoolCredentials(pool.id)).toEqual([{ username: 'vu-01', password: 'private-password' }]);
  });

  it('persists private account pools and public performance assets by project', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-performance-store-'));
    try {
      const store = createSqliteStore({ databasePath: join(directory, 'novatest.db') });
      const project = store.saveProject({ name: '一日女友性能' });
      const pool = store.savePerformanceAccountPool({
        id: 'pool-1', projectId: project.id, name: '100 VU 账号池',
        accounts: [{ username: 'vu-01', password: 'private-password' }]
      });
      expect(pool).toMatchObject({ id: 'pool-1', projectId: project.id, accountCount: 1 });
      expect(JSON.stringify(pool)).not.toContain('private-password');
      expect(store.getPerformanceAccountPoolCredentials('pool-1')).toEqual([{ username: 'vu-01', password: 'private-password' }]);

      const asset = store.savePerformanceAsset({ id: 'asset-1', projectId: project.id, name: '登录浏览点赞', protocol: 'daygf', config: { accountPoolId: 'pool-1' } });
      expect(store.listPerformanceAssets(project.id)).toEqual([asset]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('appends ordered samples to a performance run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-performance-runs-'));
    try {
      const store = createSqliteStore({ databasePath: join(directory, 'novatest.db') });
      const project = store.saveProject({ name: '性能运行' });
      store.savePerformanceAccountPool({ id: 'pool-1', projectId: project.id, name: '账号池', accounts: [{ username: 'vu-01', password: 'private-password' }] });
      store.savePerformanceAsset({ id: 'asset-1', projectId: project.id, name: '场景', protocol: 'daygf', config: { accountPoolId: 'pool-1' } });
      store.savePerformanceRun({ id: 'run-1', assetId: 'asset-1', projectId: project.id, name: '100 VU', status: 'running', summary: {}, startedAt: '2026-08-17T00:00:00.000Z' });
      store.appendPerformanceSample('run-1', { elapsedSeconds: 60, activeVus: 20, requests: 1200, failures: 0, p95Ms: 310, phase: '基线' });
      store.appendPerformanceSample('run-1', { elapsedSeconds: 120, activeVus: 20, requests: 2400, failures: 1, p95Ms: 330, phase: '基线' });
      expect(store.getPerformanceRun('run-1')).toMatchObject({ id: 'run-1', samples: [{ elapsedSeconds: 60 }, { elapsedSeconds: 120 }] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
