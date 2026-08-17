import { describe, expect, it } from 'vitest';
import { renderPerformanceReport } from '../server/services/performance-report-service.js';

describe('performance report service', () => {
  it('renders threshold verdicts and phase samples without credentials', () => {
    const html = renderPerformanceReport({
      id: 'perf-1', name: '100 VU 基线', status: 'failed', startedAt: '2026-08-17T00:00:00.000Z', finishedAt: '2026-08-17T00:15:00.000Z',
      summary: { requests: 1200, failures: 12, p95Ms: 2200, verdicts: [{ name: '读取 P95', actual: 2200, expected: 1500, passed: false }] },
      samples: [{ phase: '峰值', elapsedSeconds: 300, activeVus: 100, requests: 1200, failures: 12, p95Ms: 2200 }]
    }, { name: '登录浏览点赞', config: { accountPoolId: 'pool-1', password: 'private-password' } });

    expect(html).toContain('读取 P95');
    expect(html).toContain('失败');
    expect(html).toContain('峰值');
    expect(html).not.toContain('private-password');
    expect(html).not.toContain('accountPoolId');
  });
});
