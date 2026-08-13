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

  it('renders generic REST API evidence without an undefined business status', () => {
    const html = renderReport({
      id: 'run-1', status: 'failed', startedAt: '2026-08-13T00:00:00.000Z', finishedAt: '2026-08-13T00:00:01.000Z', variables: {},
      steps: [{ id: 'me', instruction: '查询当前用户', status: 'failed', attempts: 1, api: {
        action: '/api/me', method: 'GET', httpStatus: 401, durationMs: 12, request: {}, response: { error: 'unauthorized' }
      }}]
    }, 'REST 证据');

    expect(html).toContain('HTTP 401');
    expect(html).not.toContain('业务状态 undefined');
  });

  it('redacts credential-like query parameters from response URLs', () => {
    const html = renderReport({
      id: 'run-url', status: 'passed', startedAt: null, finishedAt: null, variables: {},
      steps: [{ id: 'home', instruction: '首页', status: 'passed', attempts: 1, api: {
        action: '/api/home', method: 'GET', httpStatus: 200, durationMs: 12, request: {},
        response: { videoUrl: 'https://video.example.test/a.m3u8?auth_key=private-url-key&via=daygf' }
      }}]
    }, 'URL 脱敏');

    expect(html).not.toContain('private-url-key');
    expect(html).toContain('auth_key=********');
  });
});
