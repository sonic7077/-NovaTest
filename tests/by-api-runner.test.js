import { describe, expect, it, vi } from 'vitest';
import { ByApiRunner } from '../server/runners/by-api-runner.js';

function response(status, body) {
  return { status, json: async () => body };
}

function byStep(action, options = {}) {
  return {
    request: {
      protocol: 'by', action, method: options.method || 'GET', payload: options.payload || {},
      expectedStatus: options.expectedStatus || 200, expectedCode: options.expectedCode ?? 0,
      safety: options.safety || 'readonly', auth: 'none', ...options
    }
  };
}

function byContext(options = {}) {
  return {
    testCase: { baseUrl: 'https://by.example.test' }, variables: {}, allowMutations: false,
    ...options
  };
}

describe('BY API runner', () => {
  it('encodes a public list query with a browser user agent and validates code 0', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toBe('https://by.example.test/c-api/v1/members?page=1&pageSize=2');
      expect(init.headers['user-agent']).toMatch(/Mozilla\/5\.0/);
      return response(200, { code: 0, msg: 'ok', data: { list: [], total: 0 } });
    });
    const runner = new ByApiRunner({ fetchImpl });

    const result = await runner.execute(byStep('/c-api/v1/members', { payload: { page: 1, pageSize: 2 } }), byContext());

    expect(result.api).toMatchObject({ httpStatus: 200, businessStatus: 0 });
  });

  it('records redacted evidence when the business code differs', async () => {
    const runner = new ByApiRunner({
      fetchImpl: async () => response(200, { code: 40000, msg: '参数错误', data: { contact: 'private' } })
    });

    await expect(runner.execute(
      byStep('/c-api/v1/reports', { method: 'POST', payload: { contact: 'private' }, expectedCode: 0 }),
      byContext()
    )).rejects.toMatchObject({
      message: 'BY business assertion failed: /c-api/v1/reports',
      api: { response: { data: { contact: '********' } } }
    });
  });

  it('rejects cross-origin, non-BY, and mutation requests before fetching', async () => {
    const fetchImpl = vi.fn();
    const runner = new ByApiRunner({ fetchImpl });

    await expect(runner.execute(byStep('https://evil.example.test/c-api/v1/members'), byContext())).rejects.toThrow('invalid BY action');
    await expect(runner.execute(byStep('/admin-api/v1/auth/info'), byContext())).rejects.toThrow('invalid BY action');
    await expect(runner.execute(byStep('/c-api/v1/reports', { method: 'POST', safety: 'mutating' }), byContext())).rejects.toThrow('mutating API step requires allowMutations');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips a chained detail step when no public list item can be extracted', async () => {
    const runner = new ByApiRunner({
      fetchImpl: async () => response(200, { code: 0, msg: 'ok', data: { list: [] } })
    });

    await expect(runner.execute(
      byStep('/c-api/v1/members', { extract: { memberPubId: '$.data.list[0].pubId' } }),
      byContext()
    )).rejects.toMatchObject({ code: 'PRECONDITION_UNAVAILABLE', message: '前置数据不足：无法提取 memberPubId' });
  });

  it('interpolates a public identifier into a chained detail path', async () => {
    const fetchImpl = vi.fn(async (url) => {
      expect(url).toBe('https://by.example.test/c-api/v1/members/public-1');
      return response(200, { code: 0, msg: 'ok', data: { pubId: 'public-1' } });
    });
    const runner = new ByApiRunner({ fetchImpl });

    await runner.execute(
      byStep('/c-api/v1/members/{{memberPubId}}', { expectedJson: [{ path: '$.data.pubId', equalsVariable: 'memberPubId' }] }),
      byContext({ variables: { memberPubId: 'public-1' } })
    );
  });
});
