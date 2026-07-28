import { describe, expect, it } from 'vitest';
import { loginLighthouse, readLighthouseCredentials } from '../server/services/lighthouse-login.js';

function fakeLocator(calls, name) {
  return {
    count: async () => 1,
    click: async () => calls.push([name, 'click']),
    fill: async (value) => calls.push([name, 'fill', value]),
    waitFor: async () => calls.push([name, 'waitFor'])
  };
}

function fakeLighthousePage(calls) {
  return {
    getByRole: (_role, options) => fakeLocator(calls, `role:${options.name}`),
    getByPlaceholder: (placeholder) => fakeLocator(calls, `placeholder:${placeholder}`)
  };
}

describe('Lighthouse login', () => {
  it('rejects missing credentials without copying their values into the error', () => {
    const providedEmail = 'person@example.test';

    expect(() => readLighthouseCredentials({ LIGHTHOUSE_EMAIL: providedEmail })).toThrow('Lighthouse credentials are incomplete');
    let error;
    try {
      readLighthouseCredentials({ LIGHTHOUSE_EMAIL: providedEmail });
    } catch (caught) {
      error = caught;
    }
    expect(error.message).not.toContain(providedEmail);
  });

  it('fills account login details, enters a generated TOTP code, and verifies the task view', async () => {
    const calls = [];

    await loginLighthouse(
      fakeLighthousePage(calls),
      { email: 'person@example.test', password: 'private-value', totpSecret: 'GEZDGNBVGY3TQOJQ' },
      { generateCode: () => '123456' }
    );

    expect(calls).toEqual([
      ['role:账号密码', 'waitFor'],
      ['role:账号密码', 'click'],
      ['placeholder:name@company.com', 'fill', 'person@example.test'],
      ['placeholder:输入密码', 'fill', 'private-value'],
      ['role:登录', 'click'],
      ['placeholder:000000', 'waitFor'],
      ['placeholder:000000', 'fill', '123456'],
      ['role:验证', 'click'],
      ['role:我负责的', 'waitFor']
    ]);
  });

  it('waits for the authenticated task heading after dynamic-code verification', async () => {
    const calls = [];
    let taskHeadingReady = false;
    const page = fakeLighthousePage(calls);
    const getByRole = page.getByRole;
    page.getByRole = (role, options) => options.name === '我负责的'
      ? {
          count: async () => taskHeadingReady ? 1 : 0,
          waitFor: async () => { taskHeadingReady = true; calls.push(['role:我负责的', 'waitFor']); }
        }
      : getByRole(role, options);

    await expect(loginLighthouse(
      page,
      { email: 'person@example.test', password: 'private-value', totpSecret: 'GEZDGNBVGY3TQOJQ' },
      { generateCode: () => '123456' }
    )).resolves.toBeUndefined();
    expect(calls).toContainEqual(['role:我负责的', 'waitFor']);
  });
});
