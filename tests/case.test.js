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

  it('preserves array values for full placeholders and validates bounded random selections', () => {
    expect(interpolate('{{selectedInterests}}', { selectedInterests: ['热门', '最新'] })).toEqual(['热门', '最新']);
    const request = {
      protocol: 'flywheel', action: '/api/v1/users/u-1', method: 'PUT', payload: { onboarding_tags: '{{selectedInterests}}' },
      expectedStatus: 200, safety: 'mutating', randomSelection: {
        variable: 'selectedInterests', values: ['热门', '最新', '精选'], minCount: 1, maxCount: 3
      }
    };
    const testCase = validateWebCase({ id: 'random-interests', projectId: 'project-1', name: '随机兴趣建档', target: 'api', baseUrl: 'https://flywheel.example.test', viewport: 'desktop', steps: [{ id: 'upsert', kind: 'apiRequest', instruction: '保存随机兴趣', request }] });
    expect(testCase.steps[0].request.randomSelection.maxCount).toBe(3);
    expect(() => validateWebCase({ ...testCase, steps: [{ ...testCase.steps[0], request: { ...request, randomSelection: { ...request.randomSelection, values: ['重复', '重复'] } } }] })).toThrow('invalid API request');
    expect(() => validateWebCase({ ...testCase, steps: [{ ...testCase.steps[0], request: { ...request, randomSelection: { ...request.randomSelection, minCount: 0 } } }] })).toThrow('invalid API request');
  });

  it('validates Flywheel recommendation policy thresholds', () => {
    const request = {
      protocol: 'flywheel', action: '/api/v1/feed', method: 'GET', payload: {}, expectedStatus: 200, safety: 'readonly',
      recommendationPolicy: { selectedTagsVariable: 'selectedInterests', requestedSize: 20, maxItems: 20, headGuard: 2, minHitRatio: 0.3, maxHitRatio: 0.8, requireUniqueContentIds: true }
    };
    const testCase = validateWebCase({ id: 'feed-policy', projectId: 'project-1', name: '推荐策略', target: 'api', baseUrl: 'https://flywheel.example.test', viewport: 'desktop', steps: [{ id: 'feed', kind: 'apiRequest', instruction: '分析推荐', request }] });
    expect(testCase.steps[0].request.recommendationPolicy.maxHitRatio).toBe(0.8);
    expect(() => validateWebCase({ ...testCase, steps: [{ ...testCase.steps[0], request: { ...request, recommendationPolicy: { ...request.recommendationPolicy, minHitRatio: 1.2 } } }] })).toThrow('invalid API request');
  });

  it('validates a minimum recommendation item threshold', () => {
    const request = {
      protocol: 'flywheel', action: '/api/v1/feed', method: 'GET', payload: {}, expectedStatus: 200, safety: 'readonly',
      recommendationPolicy: { selectedTagsVariable: 'selectedInterests', requestedSize: 20, minItems: 10, maxItems: 20, headGuard: 2, minHitRatio: 0.3, maxHitRatio: 0.8, requireUniqueContentIds: true }
    };
    const testCase = validateWebCase({ id: 'minimum-feed', projectId: 'p', name: '推荐数量', target: 'api', baseUrl: 'https://flywheel.example.test', viewport: 'desktop', steps: [{ id: 'feed', kind: 'apiRequest', instruction: '读取推荐', request }] });
    expect(testCase.steps[0].request.recommendationPolicy.minItems).toBe(10);
    expect(() => validateWebCase({ ...testCase, steps: [{ ...testCase.steps[0], request: { ...request, recommendationPolicy: { ...request.recommendationPolicy, minItems: 0 } } }] })).toThrow('invalid API request');
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

  it('accepts a standard Editorial GET API request', () => {
    const testCase = validateWebCase({
      id: 'editorial-summary', projectId: 'project-1', name: 'AI 评论概览', target: 'api',
      baseUrl: 'https://editorial.example.test', viewport: 'desktop',
      steps: [{ id: 'summary', kind: 'apiRequest', instruction: '读取 AI 评论概览', request: {
        protocol: 'editorial', action: 'ai-comment/summary', method: 'GET', payload: {}, expectedStatus: 200, safety: 'readonly'
      } }]
    });

    expect(testCase.steps[0].request.protocol).toBe('editorial');
  });

  it('accepts a BY public API request with an expected business code', () => {
    const testCase = validateWebCase({
      id: 'by-members', projectId: 'by-project', name: '会员列表', target: 'api',
      baseUrl: 'https://by.example.test', viewport: 'desktop',
      steps: [{ id: 'members', kind: 'apiRequest', instruction: '查询会员', request: {
        protocol: 'by', action: '/c-api/v1/members', method: 'GET', payload: { page: 1 },
        expectedStatus: 200, expectedCode: 0, safety: 'readonly', auth: 'none'
      } }]
    });

    expect(testCase.steps[0].request.protocol).toBe('by');
  });

  it('rejects a BY request without a numeric expected business code', () => {
    expect(() => validateWebCase({
      id: 'by-invalid', projectId: 'by-project', name: '异常', target: 'api',
      baseUrl: 'https://by.example.test', viewport: 'desktop',
      steps: [{ id: 'bad', kind: 'apiRequest', instruction: '查询', request: {
        protocol: 'by', action: '/c-api/v1/members', method: 'GET', payload: {},
        expectedStatus: 200, expectedCode: '0', safety: 'readonly', auth: 'none'
      } }]
    })).toThrow('invalid API request');
  });

  it('accepts standard Flywheel API requests for all documented HTTP methods', () => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const testCase = validateWebCase({
        id: `flywheel-${method.toLowerCase()}`, projectId: 'project-1', name: `飞轮 ${method}`, target: 'api',
        baseUrl: 'https://flywheel.example.test', viewport: 'desktop',
        steps: [{ id: 'request', kind: 'apiRequest', instruction: `执行 ${method} 请求`, request: {
          protocol: 'flywheel', action: '/api/v1/feed', method, payload: {}, expectedStatus: 200,
          safety: method === 'GET' ? 'readonly' : 'mutating'
        } }]
      });
      expect(testCase.steps[0].request.method).toBe(method);
    }
  });

  it('accepts a Daygf REST request and rejects unsupported authentication', () => {
    const input = {
      id: 'daygf-me', projectId: 'daygf-project', name: '当前用户', target: 'api',
      baseUrl: 'https://daygf.example.test', viewport: 'desktop',
      steps: [{ id: 'me', kind: 'apiRequest', instruction: '查询当前用户', request: {
        protocol: 'daygf', action: '/api/me', method: 'GET', payload: {}, expectedStatus: 200,
        safety: 'readonly', expectedJson: [{ path: '$.ok', exists: true }]
      }}]
    };

    expect(validateWebCase(input).steps[0].request.protocol).toBe('daygf');
    expect(() => validateWebCase({ ...input, steps: [{ ...input.steps[0], request: { ...input.steps[0].request, auth: 'password' } }] })).toThrow('invalid API request');
  });

  it('accepts a numeric Editorial expected-status set and rejects invalid status sets', () => {
    const request = {
      protocol: 'editorial', action: 'ai-comment/summary', method: 'GET', payload: {},
      expectedStatus: [403, 404], safety: 'readonly'
    };
    const testCase = validateWebCase({
      id: 'editorial-status-set', projectId: 'project-1', name: '项目权限边界', target: 'api',
      baseUrl: 'https://editorial.example.test', viewport: 'desktop',
      steps: [{ id: 'summary', kind: 'apiRequest', instruction: '读取项目概览', request }]
    });

    expect(testCase.steps[0].request.expectedStatus).toEqual([403, 404]);
    expect(() => validateWebCase({ ...testCase, steps: [{ ...testCase.steps[0], request: { ...request, expectedStatus: [403, '404'] } }] })).toThrow('invalid API request');
  });

  it('accepts bounded Flywheel status polling and rejects malformed polling definitions', () => {
    const request = {
      protocol: 'flywheel', action: '/api/v1/ingest/42', method: 'GET', payload: {}, expectedStatus: 200,
      safety: 'readonly', poll: { path: '$.status', values: ['done', 'failed'], intervalMs: 500, maxAttempts: 4 }
    };
    const testCase = validateWebCase({
      id: 'flywheel-poll', projectId: 'project-1', name: '采集状态轮询', target: 'api',
      baseUrl: 'https://flywheel.example.test', viewport: 'desktop',
      steps: [{ id: 'status', kind: 'apiRequest', instruction: '查询状态', request }]
    });

    expect(testCase.steps[0].request.poll.maxAttempts).toBe(4);
    expect(() => validateWebCase({ ...testCase, steps: [{ ...testCase.steps[0], request: { ...request, poll: { path: 'status', values: [], intervalMs: -1, maxAttempts: 99 } } }] })).toThrow('invalid API request');
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

  it('accepts an API list selection and variable-based JSON assertion', () => {
    const testCase = validateWebCase({
      id: 'member-audit', projectId: 'project-1', name: '用户审核', target: 'api',
      baseUrl: 'https://example.test/api.php', viewport: 'desktop',
      steps: [{ id: 'pending-members', kind: 'apiRequest', instruction: '选择待审核记录', request: {
        action: 'list_member_update_log', method: 'POST', payload: { status: 0 }, expectedStatus: 1, safety: 'readonly',
        select: { listPath: '$.data.list', variable: 'memberLogId', idPath: '$.id' },
        expectedJson: [{ path: '$.data.list[0].id', equalsVariable: 'memberLogId' }]
      }}]
    });

    expect(testCase.steps[0].request.select.variable).toBe('memberLogId');
    expect(() => validateWebCase({ ...testCase, steps: [{ ...testCase.steps[0], request: {
      ...testCase.steps[0].request, select: { listPath: 'data.list', variable: '', idPath: '$.id' }
    } }] })).toThrow('invalid API request');
  });
});
