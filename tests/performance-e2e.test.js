import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { DEFAULT_DAYGF_SCENARIO } from '../server/domain/performance.js';
import { renderPerformanceReport } from '../server/services/performance-report-service.js';
import { PerformanceService } from '../server/services/performance-service.js';

describe('controlled performance testing acceptance', () => {
  it('fails closed when k6 is unavailable and preserves a redacted report', async () => {
    const store = createMemoryStore();
    const project = store.saveProject({ name: '一日女友性能验收' });
    const pool = store.savePerformanceAccountPool({
      projectId: project.id, name: '100 VU 受控账号池',
      accounts: Array.from({ length: 100 }, (_, index) => ({ username: `vu-${index}`, password: 'private-password' }))
    });
    const config = {
      projectId: project.id, name: 'k6 不可用验收', protocol: 'daygf', baseUrl: 'https://daygf.example.test', accountPoolId: pool.id,
      dataset: { postIds: [101], historyContentIds: [201] }, securityProbe: { enabled: false, postId: 999 }, ...DEFAULT_DAYGF_SCENARIO
    };
    const asset = store.savePerformanceAsset({ projectId: project.id, name: config.name, protocol: config.protocol, config });
    let scheduled;
    const service = new PerformanceService({ store, runner: { run: async () => { throw new Error('k6 is unavailable'); } }, schedule: (callback) => { scheduled = callback; } });

    const queued = service.queue(asset.id);
    await scheduled();
    const run = store.getPerformanceRun(queued.id);
    const report = renderPerformanceReport(run, asset);

    expect(run).toMatchObject({ status: 'failed', error: 'k6 is unavailable' });
    expect(report).toContain('k6 is unavailable');
    expect(report).not.toContain('private-password');
  });
});
