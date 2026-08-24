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
    getByPlaceholder: (placeholder) => fakeLocator(calls, `placeholder:${placeholder}`),
    getByText: (text) => fakeLocator(calls, `text:${text}`)
  };
}

function fakeCompanySelectionPage(calls) {
  let companySelected = false;
  return {
    getByRole: (_role, options) => {
      if (options.name === '选择公司') return fakeLocator(calls, 'role:选择公司');
      if (options.name === '我负责的') {
        return {
          count: async () => companySelected ? 1 : 0,
          waitFor: async () => {
            if (!companySelected) throw new Error('task view unavailable');
            calls.push(['role:我负责的', 'waitFor']);
          }
        };
      }
      return fakeLocator(calls, `role:${options.name}`);
    },
    getByPlaceholder: (placeholder) => fakeLocator(calls, `placeholder:${placeholder}`),
    getByText: (text) => ({
      count: async () => text === '无极' && !companySelected ? 1 : 0,
      click: async () => { companySelected = true; calls.push([`text:${text}`, 'click']); },
      waitFor: async () => calls.push([`text:${text}`, 'waitFor'])
    })
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

  it('waits for company selection then uses 无极 as a deterministic fallback after visual recognition', async () => {
    const calls = [];
    const selectCompany = async () => calls.push(['company:visual', 'select']);

    await loginLighthouse(
      fakeCompanySelectionPage(calls),
      { email: 'person@example.test', password: 'private-value', totpSecret: 'GEZDGNBVGY3TQOJQ' },
      { generateCode: () => '123456', selectCompany }
    );

    const companyPage = calls.findIndex((entry) => entry[0] === 'role:选择公司' && entry[1] === 'waitFor');
    const visualSelection = calls.findIndex((entry) => entry[0] === 'company:visual' && entry[1] === 'select');
    const exactSelection = calls.findIndex((entry) => entry[0] === 'text:无极' && entry[1] === 'click');
    expect(companyPage).toBeLessThan(visualSelection);
    expect(visualSelection).toBeLessThan(exactSelection);
    expect(calls).toContainEqual(['role:我负责的', 'waitFor']);
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

  it('waits for the task table loading state to settle before returning from login', async () => {
    const calls = [];
    const page = fakeLighthousePage(calls);
    page.waitForFunction = async (predicate, _argument, options) => {
      calls.push(['page:waitForFunction', String(predicate), options]);
    };

    await loginLighthouse(
      page,
      { email: 'person@example.test', password: 'private-value', totpSecret: 'GEZDGNBVGY3TQOJQ' },
      { generateCode: () => '123456' }
    );

    expect(calls).toContainEqual([
      'page:waitForFunction',
      expect.stringContaining('加载中...'),
      { timeout: 30000 }
    ]);
  });
});
