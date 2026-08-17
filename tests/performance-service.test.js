import { describe, expect, it, vi } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { DEFAULT_DAYGF_SCENARIO } from '../server/domain/performance.js';
import { PerformanceService } from '../server/services/performance-service.js';

function accounts(count) {
  return Array.from({ length: count }, (_, index) => ({ username: `vu-${index + 1}`, password: 'private-password' }));
}

function performanceAsset(projectId, accountPoolId) {
  return {
    projectId, name: '100 VU 登录浏览点赞', protocol: 'daygf', baseUrl: 'https://daygf.example.test', accountPoolId,
    dataset: { postIds: [101], historyContentIds: [201] }, securityProbe: { enabled: false, postId: 999 },
    ...DEFAULT_DAYGF_SCENARIO
  };
}

describe('PerformanceService', () => {
  it('queues a performance run and persists its redacted live sample and threshold verdicts', async () => {
    const store = createMemoryStore();
    const project = store.saveProject({ name: '性能项目' });
    const pool = store.savePerformanceAccountPool({ projectId: project.id, name: '100 VU 账号池', accounts: accounts(100) });
    const definition = performanceAsset(project.id, pool.id);
    const asset = store.savePerformanceAsset({ projectId: project.id, name: definition.name, protocol: definition.protocol, config: definition });
    let scheduled;
    const runner = { run: vi.fn(async ({ onSample }) => {
      onSample({ elapsedSeconds: 10, activeVus: 20, requests: 80, failures: 0, p95Ms: 220, phase: '基线' });
      return { summary: { requests: 80, failures: 0, p95Ms: 220, loginSuccessRate: 1, readSuccessRate: 1, writeSuccessRate: 1, serverErrorRate: 0 } };
    }) };
    const service = new PerformanceService({ store, runner, schedule: (callback) => { scheduled = callback; } });

    const queued = service.queue(asset.id);
    expect(queued).toMatchObject({ status: 'queued', projectId: project.id });
    await scheduled();

    expect(store.getPerformanceRun(queued.id)).toMatchObject({
      status: 'passed', samples: [{ requests: 80, p95Ms: 220 }],
      summary: { verdicts: expect.arrayContaining([expect.objectContaining({ passed: true })]) }
    });
    expect(JSON.stringify(store.getPerformanceRun(queued.id))).not.toContain('private-password');
  });

  it('rejects an account pool smaller than the maximum configured VU count', () => {
    const store = createMemoryStore();
    const project = store.saveProject({ name: '不足账号池' });
    const pool = store.savePerformanceAccountPool({ projectId: project.id, name: '20 VU 账号池', accounts: accounts(20) });
    const definition = performanceAsset(project.id, pool.id);
    const asset = store.savePerformanceAsset({ projectId: project.id, name: definition.name, protocol: definition.protocol, config: definition });
    const service = new PerformanceService({ store, runner: { run: async () => ({}) }, schedule: () => {} });

    expect(() => service.queue(asset.id)).toThrow('账号池数量不足');
  });
});
