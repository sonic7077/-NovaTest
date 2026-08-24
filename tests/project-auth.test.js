import { describe, expect, it } from 'vitest';
import { normalizeProjectWebAuth, shouldUseByAdminLogin, shouldUseLighthouseLogin } from '../server/domain/project-auth.js';

describe('project Web authentication', () => {
  it('accepts only the lighthouse provider with a normalized web host', () => {
    expect(normalizeProjectWebAuth({ provider: 'lighthouse', host: 'DT.CHENMOYUAN.TECH' }))
      .toEqual({ provider: 'lighthouse', host: 'dt.chenmoyuan.tech' });
    expect(normalizeProjectWebAuth({ provider: 'byAdmin', host: 'BY.CHENMOYUAN.TECH' }))
      .toEqual({ provider: 'byAdmin', host: 'by.chenmoyuan.tech' });
    expect(normalizeProjectWebAuth({ provider: 'other', host: 'example.test' })).toBeUndefined();
  });

  it('matches Lighthouse only for Web UI cases on the configured host', () => {
    const project = { webAuth: { provider: 'lighthouse', host: 'dt.chenmoyuan.tech' } };

    expect(shouldUseLighthouseLogin(project, { target: 'web', baseUrl: 'https://dt.chenmoyuan.tech/dashboard/tasks/my' })).toBe(true);
    expect(shouldUseLighthouseLogin(project, { target: 'api', baseUrl: 'https://dt.chenmoyuan.tech/api' })).toBe(false);
    expect(shouldUseLighthouseLogin(project, { target: 'web', baseUrl: 'https://other.test/dashboard' })).toBe(false);
  });

  it('matches BY backend only for Web UI cases on the configured host', () => {
    const project = { webAuth: { provider: 'byAdmin', host: 'by.chenmoyuan.tech' } };

    expect(shouldUseByAdminLogin(project, { target: 'web', baseUrl: 'https://by.chenmoyuan.tech/admin-login#/operation/member' })).toBe(true);
    expect(shouldUseByAdminLogin(project, { target: 'api', baseUrl: 'https://by.chenmoyuan.tech/admin-api/v1/auth/info' })).toBe(false);
    expect(shouldUseByAdminLogin(project, { target: 'web', baseUrl: 'https://example.test/admin-login' })).toBe(false);
  });
});
