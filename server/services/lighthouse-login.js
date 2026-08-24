import { generateTotp } from './totp.js';

function safeLoginError() {
  return new Error('Lighthouse login failed: authentication flow could not complete');
}

async function requiredLocator(locator) {
  if (await locator.count() !== 1) throw safeLoginError();
  return locator;
}

async function requiredVisibleLocator(locator) {
  await locator.waitFor({ state: 'visible', timeout: 30000 });
  return requiredLocator(locator);
}

async function postVerificationView(page) {
  const companyPicker = page.getByRole('heading', { name: '选择公司', exact: true });
  const taskView = page.getByRole('heading', { name: '我负责的', exact: true });
  return Promise.any([
    requiredVisibleLocator(companyPicker).then(() => 'company'),
    requiredVisibleLocator(taskView).then(() => 'tasks')
  ]);
}

async function selectCompanyFallback(page) {
  const company = page.getByText('无极', { exact: true });
  if (await company.count() === 0) return;
  await (await requiredVisibleLocator(company)).click();
}

async function waitForTaskList(page) {
  if (typeof page.waitForFunction !== 'function') return;
  await page.waitForFunction(() => !document.body.innerText.includes('加载中...'), undefined, { timeout: 30000 });
}

export function readLighthouseCredentials(env) {
  const email = String(env.LIGHTHOUSE_EMAIL || '').trim();
  const password = String(env.LIGHTHOUSE_PASSWORD || '');
  const totpSecret = String(env.LIGHTHOUSE_TOTP_SECRET || '').trim();
  if (!email || !password || !totpSecret) throw new Error('Lighthouse credentials are incomplete');
  return { email, password, totpSecret };
}

export async function loginLighthouse(page, credentials, { generateCode = generateTotp, selectCompany } = {}) {
  try {
    await (await requiredVisibleLocator(page.getByRole('button', { name: '账号密码', exact: true }))).click();
    await (await requiredLocator(page.getByPlaceholder('name@company.com', { exact: true }))).fill(credentials.email);
    await (await requiredLocator(page.getByPlaceholder('输入密码', { exact: true }))).fill(credentials.password);
    await (await requiredLocator(page.getByRole('button', { name: '登录', exact: true }))).click();
    await (await requiredVisibleLocator(page.getByPlaceholder('000000', { exact: true }))).fill(generateCode(credentials.totpSecret));
    await (await requiredLocator(page.getByRole('button', { name: '验证', exact: true }))).click();
    if (selectCompany && await postVerificationView(page) === 'company') {
      try { await selectCompany(page); } catch {}
      await selectCompanyFallback(page);
    }
    await requiredVisibleLocator(page.getByRole('heading', { name: '我负责的', exact: true }));
    await waitForTaskList(page);
  } catch (error) {
    if (error.message.startsWith('Lighthouse login failed:')) throw error;
    throw safeLoginError();
  }
}
