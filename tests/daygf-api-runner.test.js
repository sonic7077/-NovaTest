import { describe, expect, it } from 'vitest';
import { DaygfApiRunner } from '../server/runners/daygf-api-runner.js';

const config = {
  baseUrl: 'https://daygf.example.test', username: 'daygf-user', password: 'daygf-password'
};

function response(status, body, { json = true } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: json ? async () => body : async () => { throw new Error('invalid JSON'); }
  };
}

function step(action, options = {}) {
  return {
    id: action.replaceAll('/', '-'), kind: 'apiRequest', instruction: action,
    request: {
      protocol: 'daygf', action, method: options.method || 'GET', payload: options.payload || {},
      expectedStatus: options.expectedStatus || 200, safety: options.safety || 'readonly', ...options
    }
  };
}

describe('Daygf API runner', () => {
  it('logs in once and attaches the session token to two protected requests', async () => {
    const calls = [];
    const runner = new DaygfApiRunner({
      config,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/api/login')) return response(200, { ok: true, token: 'private-jwt', refresh_token: 'private-refresh' });
        return response(200, { ok: true, id: 7 });
      }
    });
    const context = { testCase: { baseUrl: config.baseUrl }, variables: {} };

    await runner.execute(step('/api/me'), context);
    await runner.execute(step('/api/profile/data'), context);

    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[0].options.body)).toEqual({ username: config.username, password: config.password });
    expect(calls.slice(1).map(({ options }) => options.headers['x-token'])).toEqual(['private-jwt', 'private-jwt']);
    expect(calls.slice(1).map(({ options }) => options.headers.authorization)).toEqual(['Bearer private-jwt', 'Bearer private-jwt']);
  });

  it('does not authenticate a no-token negative probe', async () => {
    const calls = [];
    const runner = new DaygfApiRunner({
      config,
      fetchImpl: async (url) => { calls.push(url); return response(401, { ok: false }); }
    });

    await runner.execute(step('/api/me', { auth: 'none', expectedStatus: 401 }), { testCase: { baseUrl: config.baseUrl }, variables: {} });

    expect(calls).toEqual(['https://daygf.example.test/api/me']);
  });

  it('serializes GET query values and JSON request bodies', async () => {
    const calls = [];
    const runner = new DaygfApiRunner({
      config,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(200, { ok: true });
      }
    });
    const context = { testCase: { baseUrl: config.baseUrl }, variables: {} };

    await runner.execute(step('/api/search', { auth: 'none', payload: { q: '杭州', tags: ['a', 'b'] } }), context);
    await runner.execute(step('/api/search/history', { auth: 'none', method: 'POST', payload: { keyword: '杭州' } }), context);

    expect(calls[0].url).toBe('https://daygf.example.test/api/search?q=%E6%9D%AD%E5%B7%9E&tags=a&tags=b');
    expect(calls[1].options.headers['content-type']).toBe('application/json');
    expect(calls[1].options.body).toBe('{"keyword":"杭州"}');
  });

  it('uses a deliberate invalid token without logging in', async () => {
    const calls = [];
    const runner = new DaygfApiRunner({
      config,
      fetchImpl: async (url, options) => { calls.push({ url, options }); return response(401, { ok: false }); }
    });

    await runner.execute(step('/api/me', { auth: 'invalid', expectedStatus: 401 }), { testCase: { baseUrl: config.baseUrl }, variables: {} });

    expect(calls).toHaveLength(1);
    expect(calls[0].options.headers).toMatchObject({ 'x-token': 'invalid-token', authorization: 'Bearer invalid-token' });
  });

  it('extracts variables and reports a list precondition when no candidate is available', async () => {
    const runner = new DaygfApiRunner({
      config,
      fetchImpl: async (url) => url.endsWith('/api/login')
        ? response(200, { ok: true, token: 'private-jwt' })
        : response(200, { ok: true, items: [{ id: 9 }] })
    });
    const context = { testCase: { baseUrl: config.baseUrl }, variables: {}, selectedApiIds: new Set() };
    const result = await runner.execute(step('/api/content/list', {
      extract: { firstId: '$.items[0].id' },
      select: { listPath: '$.items', variable: 'contentId', idPath: '$.id' }
    }), context);

    expect(result.variables).toEqual({ firstId: 9, contentId: 9 });
    await expect(runner.execute(step('/api/content/list', {
      select: { listPath: '$.items', variable: 'contentId', idPath: '$.id' }
    }), context)).rejects.toMatchObject({ code: 'PRECONDITION_UNAVAILABLE' });
  });

  it('blocks a mutation without explicit authorization', async () => {
    const runner = new DaygfApiRunner({ config, fetchImpl: async () => { throw new Error('must not fetch'); } });

    await expect(runner.execute(step('/api/post/publish', { method: 'POST', safety: 'mutating' }), {
      testCase: { baseUrl: config.baseUrl }, variables: {}
    })).rejects.toThrow('mutating API step requires allowMutations');
  });

  it('redacts credentials and token values from failed evidence', async () => {
    const runner = new DaygfApiRunner({
      config,
      fetchImpl: async (url) => url.endsWith('/api/login')
        ? response(200, { ok: true, token: 'private-jwt', refresh_token: 'private-refresh' })
        : response(500, {
          ok: false, token: 'private-jwt', nested: { refresh_token: 'private-refresh' },
          videoUrl: 'https://video.example.test/stream.m3u8?auth_key=private-video-key&via=daygf'
        })
    });

    await expect(runner.execute(step('/api/me'), { testCase: { baseUrl: config.baseUrl }, variables: {} }))
      .rejects.toMatchObject({ api: expect.objectContaining({ httpStatus: 500 }) });
    try {
      await runner.execute(step('/api/me'), { testCase: { baseUrl: config.baseUrl }, variables: {} });
    } catch (error) {
      const evidence = JSON.stringify(error.api);
      expect(evidence).not.toContain(config.password);
      expect(evidence).not.toContain('private-jwt');
      expect(evidence).not.toContain('private-refresh');
      expect(evidence).not.toContain('private-video-key');
    }
  });
});
