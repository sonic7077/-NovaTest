import { describe, expect, it } from 'vitest';
import { renderReport } from '../server/services/report-service.js';

describe('report service', () => {
  it('renders recommendation policy analysis alongside API evidence', () => {
    const html = renderReport({
      id: 'run-1', status: 'passed', startedAt: '2026-08-06T00:00:00.000Z', finishedAt: '2026-08-06T00:00:01.000Z', variables: {},
      steps: [{ id: 'feed', instruction: '获取推荐', status: 'passed', attempts: 1, api: {
        action: '/api/v1/feed', httpStatus: 200, durationMs: 12, request: { size: 20 }, response: { items: [] },
        analysis: { selectedTags: ['热门'], hitRatio: 0.5, interestFloor: { passed: true }, exploration: { status: 'unobservable' } }
      }}]
    }, '推荐策略分析');

    expect(html).toContain('推荐策略分析');
    expect(html).toContain('&quot;selectedTags&quot;');
    expect(html).toContain('&quot;unobservable&quot;');
  });
});
