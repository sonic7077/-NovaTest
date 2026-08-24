import { generateTotp } from './totp.js';

function safeLoginError() {
  return new Error('BY admin login failed: authentication flow could not complete');
}

async function requiredVisibleLocator(locator) {
  await locator.waitFor({ state: 'visible', timeout: 30000 });
  if (await locator.count() !== 1) throw safeLoginError();
  return locator;
}

export async function loginByAdmin(page, credentials, { generateCode = generateTotp } = {}) {
  if (!credentials?.username || !credentials?.password || !credentials?.totpSecret) throw safeLoginError();
  try {
    await (await requiredVisibleLocator(page.getByPlaceholder('账号', { exact: true }))).fill(credentials.username);
    await (await requiredVisibleLocator(page.getByPlaceholder('密码', { exact: true }))).fill(credentials.password);
    await (await requiredVisibleLocator(page.getByRole('button', { name: '登录', exact: true }))).click();
    await (await requiredVisibleLocator(page.getByPlaceholder('6 位动态验证码', { exact: true }))).fill(generateCode(credentials.totpSecret));
    await (await requiredVisibleLocator(page.getByRole('button', { name: '验证并登录', exact: true }))).click();
    await requiredVisibleLocator(page.getByText('运营看板', { exact: true }));
  } catch (error) {
    if (error.message.startsWith('BY admin login failed:')) throw error;
    throw safeLoginError();
  }
}
