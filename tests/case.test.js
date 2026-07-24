import { describe, expect, it } from 'vitest';
import { interpolate, validateWebCase } from '../server/domain/case.js';

describe('web test case', () => {
  it('accepts a desktop web case with natural language steps', () => {
    const testCase = validateWebCase({
      projectId: 'project-1',
      name: '登录',
      target: 'web',
      baseUrl: 'https://example.test',
      viewport: 'desktop',
      steps: [{ id: 's1', kind: 'action', instruction: '点击登录' }]
    });

    expect(testCase.target).toBe('web');
  });

  it('replaces variables recursively and rejects a missing variable', () => {
    expect(interpolate('订单 {{orderId}}', { orderId: 'A-1' })).toBe('订单 A-1');
    expect(interpolate({ order: '{{orderId}}' }, { orderId: 'A-1' })).toEqual({ order: 'A-1' });
    expect(() => interpolate('{{missing}}', {})).toThrow('missing variable: missing');
  });

  it('accepts case-scoped visual baselines and rejects invalid ones', () => {
    const testCase = validateWebCase({
      id: 'case-1', projectId: 'project-1', name: '登录', target: 'web', baseUrl: 'https://example.test', viewport: 'desktop',
      steps: [{
        id: 's1', kind: 'assert', instruction: '显示登录按钮',
        visualChecks: [{ id: 'visual-1', assetPath: 'case-1/visual-1.png', source: 'upload', description: '登录按钮在首屏可见' }]
      }]
    });

    expect(testCase.steps[0].visualChecks).toHaveLength(1);
    expect(() => validateWebCase({ ...testCase, steps: [{ ...testCase.steps[0], visualChecks: [{ id: 'visual-2', assetPath: 'other/visual-2.png', source: 'upload', description: '' }] }] })).toThrow('invalid visual check');
  });

  it('accepts explicit readonly API request steps and rejects unsafe request definitions', () => {
    const testCase = validateWebCase({
      id: 'api-case-1', projectId: 'project-1', name: '帖子列表', target: 'api', baseUrl: 'https://example.test/api.php', viewport: 'desktop',
      steps: [{ id: 's1', kind: 'apiRequest', instruction: '查询帖子列表', request: { action: 'list_post', method: 'POST', payload: { status: 10 }, expectedStatus: 1, safety: 'readonly' } }]
    });

    expect(testCase.target).toBe('api');
    expect(() => validateWebCase({ ...testCase, steps: [{ ...testCase.steps[0], request: { ...testCase.steps[0].request, method: 'GET' } }] })).toThrow('invalid API request');
  });

  it('accepts an API request that explicitly skips session authentication', () => {
    const testCase = validateWebCase({
      id: 'invalid-token', projectId: 'project-1', name: '无效登录态拦截', target: 'api',
      baseUrl: 'https://example.test/api.php', viewport: 'desktop',
      steps: [{ id: 'probe', kind: 'apiRequest', instruction: '使用无效令牌查询帖子', request: {
        action: 'list_post', method: 'POST', payload: { token: 'invalid-token' },
        expectedStatus: 0, safety: 'readonly', auth: 'none'
      } }]
    });

    expect(testCase.steps[0].request.auth).toBe('none');
  });

  it('rejects unsupported API authentication modes', () => {
    expect(() => validateWebCase({
      id: 'bad-auth', projectId: 'project-1', name: '错误认证方式', target: 'api',
      baseUrl: 'https://example.test/api.php', viewport: 'desktop',
      steps: [{ id: 'probe', kind: 'apiRequest', instruction: '查询', request: {
        action: 'list_post', method: 'POST', payload: {}, expectedStatus: 1,
        safety: 'readonly', auth: 'password'
      } }]
    })).toThrow('invalid API request');
  });
});
