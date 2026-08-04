import { describe, expect, it } from 'vitest';
import { EditorialApiRunner } from '../server/runners/editorial-api-runner.js';

const config = {
  baseUrl: 'https://editorial.example.test', username: 'editorial-admin', password: 'editorial-password',
  googleSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
};

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function editorialStep(action, options = {}) {
  return {
    id: action.replaceAll('/', '-'), kind: 'apiRequest', instruction: action,
    request: { protocol: 'editorial', action, method: options.method || 'GET', payload: options.payload || {}, expectedStatus: options.expectedStatus || 200, safety: options.safety || 'readonly', ...options }
  };
}

describe('Editorial API runner', () => {
  it('logs in once, sends Bearer authentication, and redacts JWT evidence', async () => {
    const calls = [];
    const runner = new EditorialApiRunner({
      config,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return url.endsWith('/api/auth/login')
          ? response(200, { access_token: 'private-jwt' })
          : response(200, { today: '2026-08-04', rows: [] });
      }
    });
    const context = { testCase: { baseUrl: config.baseUrl }, variables: {} };

    const first = await runner.execute(editorialStep('ai-comment/summary'), context);
    await runner.execute(editorialStep('ai-comment/configs'), context);

    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[0].options.body)).toMatchObject({ username: config.username, password: config.password, totp_code: expect.stringMatching(/^\d{6}$/) });
    expect(calls.slice(1).map(({ options }) => options.headers.authorization)).toEqual(['Bearer private-jwt', 'Bearer private-jwt']);
    expect(JSON.stringify(first.api)).not.toContain('private-jwt');
    expect(JSON.stringify(first.api)).not.toContain(config.password);
  });

  it('selects one manual-review record, extracts its CMS id, and reserves the local id', async () => {
    const runner = new EditorialApiRunner({
      config,
      fetchImpl: async (url) => url.endsWith('/api/auth/login')
        ? response(200, { access_token: 'private-jwt' })
        : response(200, { items: [{ id: 42, cms_comment_id: 'cms-42' }] })
    });
    const context = { testCase: { baseUrl: config.baseUrl }, variables: {}, selectedApiIds: new Set() };

    const result = await runner.execute(editorialStep('ai-comment-review/list', {
      payload: { status: 'manual_review' }, select: {
        listPath: '$.items', variable: 'commentId', idPath: '$.id', extract: { cmsCommentId: '$.cms_comment_id' }
      }
    }), context);

    expect(result.variables).toEqual({ commentId: 42, cmsCommentId: 'cms-42' });
    expect(context.selectedApiIds).toEqual(new Set(['42']));
  });

  it('returns a precondition result when no manual-review record exists', async () => {
    const runner = new EditorialApiRunner({
      config,
      fetchImpl: async (url) => url.endsWith('/api/auth/login')
        ? response(200, { access_token: 'private-jwt' })
        : response(200, { items: [] })
    });

    await expect(runner.execute(editorialStep('ai-comment-review/list', {
      payload: { status: 'manual_review' }, select: { listPath: '$.items', variable: 'commentId', idPath: '$.id' }
    }), { testCase: { baseUrl: config.baseUrl }, variables: {}, selectedApiIds: new Set() }))
      .rejects.toMatchObject({ code: 'PRECONDITION_UNAVAILABLE' });
  });

  it('blocks review actions unless mutation authorization is explicit', async () => {
    const runner = new EditorialApiRunner({ config, fetchImpl: async () => { throw new Error('must not fetch'); } });

    await expect(runner.execute(editorialStep('ai-comment-review/action', {
      method: 'POST', safety: 'mutating', payload: { action: 'approve', comment_ids: [42] }
    }), { testCase: { baseUrl: config.baseUrl }, variables: {} }))
      .rejects.toThrow('mutating API step requires allowMutations');
  });
});
