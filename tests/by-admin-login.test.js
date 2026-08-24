import { describe, expect, it } from 'vitest';
import { loginByAdmin } from '../server/services/by-admin-login.js';

function locator(calls, name) {
  return {
    count: async () => 1,
    waitFor: async () => calls.push([name, 'waitFor']),
    fill: async (value) => calls.push([name, 'fill', value]),
    click: async () => calls.push([name, 'click'])
  };
}

describe('BY backend login', () => {
  it('fills credentials, submits a dynamic code, and confirms the dashboard', async () => {
    const calls = [];
    const page = {
      getByPlaceholder: (name) => locator(calls, `placeholder:${name}`),
      getByRole: (_role, { name }) => locator(calls, `role:${name}`),
      getByText: (name) => locator(calls, `text:${name}`)
    };

    await loginByAdmin(page, { username: 'operator', password: 'private-value', totpSecret: 'JBSWY3DPEHPK3PXP' }, { generateCode: () => '123456' });

    expect(calls).toEqual([
      ['placeholder:账号', 'waitFor'], ['placeholder:账号', 'fill', 'operator'],
      ['placeholder:密码', 'waitFor'], ['placeholder:密码', 'fill', 'private-value'],
      ['role:登录', 'waitFor'], ['role:登录', 'click'],
      ['placeholder:6 位动态验证码', 'waitFor'], ['placeholder:6 位动态验证码', 'fill', '123456'],
      ['role:验证并登录', 'waitFor'], ['role:验证并登录', 'click'],
      ['text:运营看板', 'waitFor']
    ]);
  });
});
