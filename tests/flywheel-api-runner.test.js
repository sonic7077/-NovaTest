import { describe, expect, it } from 'vitest';
import { FlywheelApiRunner } from '../server/runners/flywheel-api-runner.js';

const config = {
  baseUrl: 'https://flywheel.example.test', platformKey: 'private-platform-key', platformId: 'tenant-a'
};

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function step(action, options = {}) {
  return {
    id: action.replaceAll('/', '-'), kind: 'apiRequest', instruction: action,
    request: {
      protocol: 'flywheel', action, method: options.method || 'GET', payload: options.payload || {},
      expectedStatus: options.expectedStatus ?? 200, safety: options.safety || 'readonly', ...options
    }
  };
}

function recommendationItems(tags, count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    content_id: `c-${index + 1}`,
    title: `内容 ${index + 1}`,
    tags: [{ tag: tags[index] || '探索', weight: 0.9 }],
    score: 0.8
  }));
}

function policy() {
  return {
    selectedTagsVariable: 'selectedInterests', requestedSize: 20, maxItems: 20,
    headGuard: 2, minHitRatio: 0.3, maxHitRatio: 0.8, requireUniqueContentIds: true
  };
}

describe('Flywheel API runner', () => {
  it('selects a stable 1-3 interest combination and preserves it as an array', async () => {
    const calls = [];
    const runner = new FlywheelApiRunner({
      config,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(200, { ok: true });
      }
    });
    const userStep = step('/api/v1/users/u-1', {
      method: 'PUT', safety: 'mutating', payload: { onboarding_tags: '{{selectedInterests}}' },
      randomSelection: { variable: 'selectedInterests', values: ['热门', '最新', '精选', '偷拍'], minCount: 1, maxCount: 3 }
    });
    const context = { testCase: { baseUrl: config.baseUrl }, variables: { runId: 'stable-run' }, allowMutations: true };

    const first = await runner.execute(userStep, context);
    const second = await runner.execute(userStep, context);

    expect(first.variables.selectedInterests.length).toBeGreaterThanOrEqual(1);
    expect(first.variables.selectedInterests.length).toBeLessThanOrEqual(3);
    expect(first.variables.selectedInterests).toEqual(second.variables.selectedInterests);
    expect(JSON.parse(calls[0].options.body).onboarding_tags).toEqual(first.variables.selectedInterests);
  });

  it('analyzes feed policy metrics and reports per-item tag matches', async () => {
    const runner = new FlywheelApiRunner({
      config,
      fetchImpl: async () => response(200, { items: recommendationItems(['热门', '热门', '最新', '最新', '探索', '探索', '探索', '探索', '探索', '探索']), next_cursor: null })
    });
    const result = await runner.execute(step('/api/v1/feed', {
      payload: { user_id: 'u-1', size: 20, session_id: 's-1' },
      recommendationPolicy: policy()
    }), { testCase: { baseUrl: config.baseUrl }, variables: { selectedInterests: ['热门', '最新'] } });

    expect(result.api.analysis).toMatchObject({ itemCount: 10, hitCount: 4, hitRatio: 0.4, dataShortfall: true });
    expect(result.api.analysis.headGuard).toMatchObject({ passed: true, checked: 2 });
    expect(result.api.analysis.interestCap).toMatchObject({ passed: true, configured: 0.8 });
    expect(result.api.analysis.items[0]).toMatchObject({ contentId: 'c-1', matchedTags: ['热门'] });
    expect(result.api.analysis.exploration.status).toBe('unobservable');
  });

  it.each([
    ['fails when the first two results do not match selected interests', recommendationItems(['探索', '热门', '热门', '探索', '探索', '探索', '探索', '探索', '探索', '探索'])],
    ['fails when hit ratio is below the configured floor', recommendationItems(['探索', '探索', '探索', '探索', '探索', '探索', '探索', '探索', '热门', '探索'])],
    ['fails when selected-interest ratio exceeds the configured cap', recommendationItems(['热门', '热门', '热门', '热门', '热门', '热门', '热门', '热门', '热门', '探索'])],
    ['fails when content ids are duplicated', [{ content_id: 'same', tags: [{ tag: '热门' }] }, ...recommendationItems(['热门', '热门', '探索', '探索', '探索', '探索', '探索', '探索', '探索'])]]
  ])('%s', async (_name, items) => {
    const runner = new FlywheelApiRunner({ config, fetchImpl: async () => response(200, { items }) });
    await expect(runner.execute(step('/api/v1/feed', { recommendationPolicy: policy() }), {
      testCase: { baseUrl: config.baseUrl }, variables: { selectedInterests: ['热门'] }
    })).rejects.toMatchObject({ api: { analysis: expect.any(Object) } });
  });

  it('sends encoded GET parameters with platform authentication and redacted evidence', async () => {
    const calls = [];
    const runner = new FlywheelApiRunner({
      config,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(200, { items: [] });
      }
    });

    const result = await runner.execute(step('/api/v1/feed', {
      payload: { user_id: 'u-1', size: 10, exclude: ['c-1', 'c-2'] }
    }), { testCase: { baseUrl: config.baseUrl }, variables: {} });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://flywheel.example.test/api/v1/feed?user_id=u-1&size=10&exclude=c-1&exclude=c-2');
    expect(calls[0].options.headers['x-platform-key']).toBe(config.platformKey);
    expect(calls[0].options.headers['user-agent']).toContain('NovaTest');
    expect(JSON.stringify(result.api)).not.toContain(config.platformKey);
  });

  it('sends JSON bodies for POST and interpolates prior variables', async () => {
    const calls = [];
    const runner = new FlywheelApiRunner({
      config,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(200, { ok: true });
      }
    });

    await runner.execute(step('/api/v1/feedback', {
      method: 'POST', safety: 'mutating', payload: { user_id: '{{userId}}', event: 'like' }
    }), { testCase: { baseUrl: config.baseUrl }, variables: { userId: 'tenant-a-user' }, allowMutations: true });

    expect(calls[0]).toMatchObject({
      url: 'https://flywheel.example.test/api/v1/feedback',
      options: { method: 'POST', headers: expect.objectContaining({ 'content-type': 'application/json' }) }
    });
    expect(JSON.parse(calls[0].options.body)).toEqual({ user_id: 'tenant-a-user', event: 'like' });
  });

  it('provides the configured platform ID for seed-case variables without persisting the Key', async () => {
    const calls = [];
    const runner = new FlywheelApiRunner({
      config,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(200, { ok: true });
      }
    });

    await runner.execute(step('/api/v1/users/{{platformId}}-novatest-{{runId}}', {
      method: 'PUT', safety: 'mutating', payload: { region: 'CN' }
    }), { testCase: { baseUrl: config.baseUrl }, variables: { runId: 'run-1' }, allowMutations: true });

    expect(calls[0].url).toBe('https://flywheel.example.test/api/v1/users/tenant-a-novatest-run-1');
  });

  it('polls an asynchronous ingest status before extracting a content ID', async () => {
    const calls = [];
    const runner = new FlywheelApiRunner({
      config,
      sleep: async () => undefined,
      fetchImpl: async (url) => {
        calls.push(url);
        return calls.length === 1
          ? response(200, { job_id: 42, status: 'processing' })
          : response(200, { job_id: 42, status: 'done', content_id: 'c-42' });
      }
    });

    const result = await runner.execute(step('/api/v1/ingest/42', {
      poll: { path: '$.status', values: ['done', 'dup', 'blocked', 'failed'], intervalMs: 1, maxAttempts: 2 },
      extract: { contentId: '$.content_id' }
    }), { testCase: { baseUrl: config.baseUrl }, variables: {} });

    expect(calls).toHaveLength(2);
    expect(result.variables).toEqual({ contentId: 'c-42' });
  });

  it('requires mutation authorization before sending a write request', async () => {
    const runner = new FlywheelApiRunner({ config, fetchImpl: async () => { throw new Error('must not fetch'); } });

    await expect(runner.execute(step('/api/v1/users/u-1', { method: 'PUT', safety: 'mutating' }), {
      testCase: { baseUrl: config.baseUrl }, variables: {}
    })).rejects.toThrow('mutating API step requires allowMutations');
  });

  it('accepts an expected unauthenticated 401 probe without sending platform authentication', async () => {
    const calls = [];
    const runner = new FlywheelApiRunner({
      config,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(401, { detail: 'missing platform key' });
      }
    });

    const result = await runner.execute(step('/api/v1/feed', { auth: 'none', expectedStatus: 401 }), {
      testCase: { baseUrl: config.baseUrl }, variables: {}
    });

    expect(result.api.httpStatus).toBe(401);
    expect(calls[0].options.headers).not.toHaveProperty('x-platform-key');
  });

  it('uses a synthetic value for an invalid-key probe instead of the configured key', async () => {
    const calls = [];
    const runner = new FlywheelApiRunner({
      config,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(401, { detail: 'invalid platform key' });
      }
    });

    await runner.execute(step('/api/v1/feed', { auth: 'invalid', expectedStatus: 401 }), {
      testCase: { baseUrl: config.baseUrl }, variables: {}
    });

    expect(calls[0].options.headers['x-platform-key']).not.toBe(config.platformKey);
  });

  it('keeps the platform Key out of failed request evidence', async () => {
    const runner = new FlywheelApiRunner({
      config,
      fetchImpl: async () => response(500, { detail: `failed with ${config.platformKey}` })
    });

    const failure = await runner.execute(step('/api/v1/feed'), {
      testCase: { baseUrl: config.baseUrl }, variables: {}
    }).catch((error) => error);

    expect(failure.api).toBeDefined();
    expect(JSON.stringify(failure.api)).not.toContain(config.platformKey);
  });
});
