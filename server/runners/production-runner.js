import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { shouldUseByAdminLogin, shouldUseLighthouseLogin } from '../domain/project-auth.js';
import { loginByAdmin } from '../services/by-admin-login.js';
import { loginLighthouse } from '../services/lighthouse-login.js';
import { DEFAULT_MODEL_USER_AGENT } from '../services/model-config-service.js';
import { createWebRunner } from './web-runner.js';

const requiredSettings = [
  'MIDSCENE_MODEL_BASE_URL',
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_NAME'
];
const defaultReplanningCycleLimit = 8;
const minReplanningCycleLimit = 1;
const maxReplanningCycleLimit = 80;

export function assertMidsceneConfig(env) {
  const missing = requiredSettings.filter((name) => !env[name]);
  if (missing.length) throw new Error(`missing Midscene configuration: ${missing.join(', ')}`);
}

export function midsceneConfigFromModel(modelConfig = {}) {
  return {
    MIDSCENE_MODEL_BASE_URL: String(modelConfig.baseUrl || ''),
    MIDSCENE_MODEL_NAME: String(modelConfig.modelName || ''),
    MIDSCENE_MODEL_FAMILY: String(modelConfig.modelFamily || ''),
    MIDSCENE_MODEL_API_KEY: String(modelConfig.apiKey || ''),
    MIDSCENE_MODEL_INIT_CONFIG_JSON: JSON.stringify({
      defaultHeaders: { 'User-Agent': String(modelConfig.userAgent || DEFAULT_MODEL_USER_AGENT) }
    })
  };
}

function systemChromeCandidates(platform) {
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
    ];
  }
  if (platform === 'linux') return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium'];
  return [];
}

export function resolveBrowserLaunchOptions(env, { platform = process.platform, exists = existsSync } = {}) {
  const executablePath = String(env.PLAYWRIGHT_EXECUTABLE_PATH || '').trim();
  if (executablePath) return { headless: true, executablePath };
  const systemChrome = systemChromeCandidates(platform).find((candidate) => exists(candidate));
  return systemChrome ? { headless: true, executablePath: systemChrome } : { headless: true };
}

export function resolveMidsceneReplanningCycleLimit(env) {
  const configured = String(env.MIDSCENE_REPLANNING_CYCLE_LIMIT || '').trim();
  if (!/^\d+$/.test(configured)) return defaultReplanningCycleLimit;
  const limit = Number(configured);
  if (!Number.isInteger(limit) || limit < minReplanningCycleLimit || limit > maxReplanningCycleLimit) return defaultReplanningCycleLimit;
  return limit;
}

export function createMidsceneAgentFactory(PlaywrightAgent, env) {
  const options = { replanningCycleLimit: resolveMidsceneReplanningCycleLimit(env) };
  return (page) => new PlaywrightAgent(page, options);
}

export function resolveCaseAssetPath(assetPath, caseAssetsDir = join(process.cwd(), 'data/case-assets')) {
  if (typeof assetPath !== 'string' || !assetPath || isAbsolute(assetPath) || assetPath.includes('\\')) return undefined;
  const root = resolve(caseAssetsDir);
  const fullPath = resolve(root, assetPath);
  return fullPath.startsWith(`${root}/`) ? fullPath : undefined;
}

function isClosedBrowserError(error) {
  return /Target page, context or browser has been closed/.test(error?.message || '');
}

export function createBrowserFactory({ launch }) {
  let instance;

  async function currentBrowser() {
    if (!instance || instance.isConnected?.() === false) {
      instance = await launch();
      if (instance.isConnected?.() === false) instance = await launch();
    }
    return instance;
  }

  async function openContext({ viewport }) {
      let browser = await currentBrowser();
      try {
        const context = await browser.newContext({ viewport });
        return { context, page: await context.newPage(), close: () => context.close() };
      } catch (error) {
        if (!isClosedBrowserError(error)) throw error;
        instance = undefined;
        browser = await currentBrowser();
        const context = await browser.newContext({ viewport });
        return { context, page: await context.newPage(), close: () => context.close() };
      }
  }

  return {
    openContext,
    async openPage(options) {
      const session = await openContext(options);
      return { page: session.page, close: session.close };
    }
  };
}

export function createLighthouseBeforeFirstStep({ credentials, login = loginLighthouse, selectCompany } = {}) {
  return async (page, context) => {
    if (!shouldUseLighthouseLogin(context.project, context.testCase)) return;
    const workerCredentials = context.worker?.account?.email
      ? { email: context.worker.account.email, password: context.worker.account.password, totpSecret: context.worker.account.totpSecret }
      : credentials;
    if (selectCompany) return login(page, workerCredentials, { selectCompany });
    await login(page, workerCredentials);
  };
}

export function createByAdminBeforeFirstStep({ credentials, login = loginByAdmin } = {}) {
  return async (page, context) => {
    if (!shouldUseByAdminLogin(context.project, context.testCase)) return;
    const workerCredentials = context.worker?.account?.username
      ? { username: context.worker.account.username, password: context.worker.account.password, totpSecret: context.worker.account.totpSecret }
      : credentials;
    await login(page, workerCredentials);
  };
}

export function createProjectBeforeFirstStep({ lighthouseCredentials, byAdminCredentials, lighthouseLogin, byAdminLogin } = {}) {
  const lighthouse = createLighthouseBeforeFirstStep({ credentials: lighthouseCredentials, login: lighthouseLogin });
  const byAdmin = createByAdminBeforeFirstStep({ credentials: byAdminCredentials, login: byAdminLogin });
  return async (page, context) => {
    await lighthouse(page, context);
    await byAdmin(page, context);
  };
}

export function createLighthouseCompanySelector(agentFactory) {
  return async (page) => {
    const agent = agentFactory(page);
    await agent.aiAct('检查当前登录流程页面。仅当页面显示“选择公司”并存在名称为“无极”的公司选项时，依据当前页面视觉内容点击“无极”；若已进入其他页面则不要操作。');
  };
}

export async function createProductionRunner({ modelConfig, lighthouseCredentials, byAdminCredentials, env = process.env, screenshotDir = 'data/evidence', caseAssetsDir = join(process.cwd(), 'data/case-assets'), beforeFirstStep } = {}) {
  const midsceneConfig = midsceneConfigFromModel(modelConfig);
  assertMidsceneConfig(midsceneConfig);
  const [{ chromium }, { PlaywrightAgent }, { overrideAIConfig }] = await Promise.all([
    import('playwright'),
    import('@midscene/web/playwright'),
    import('@midscene/shared/env')
  ]);
  overrideAIConfig(midsceneConfig);
  await mkdir(screenshotDir, { recursive: true });
  const browser = createBrowserFactory({ launch: () => chromium.launch(resolveBrowserLaunchOptions(env)) });
  const agentFactory = createMidsceneAgentFactory(PlaywrightAgent, env);
  const selectLighthouseCompany = createLighthouseCompanySelector(agentFactory);

  return createWebRunner({
    browser,
    agentFactory,
    beforeFirstStep: beforeFirstStep || createProjectBeforeFirstStep({
      lighthouseCredentials,
      byAdminCredentials,
      lighthouseLogin: (page, credentials) => loginLighthouse(page, credentials, { selectCompany: selectLighthouseCompany })
    }),
    screenshotDir,
    resolveAssetPath: (assetPath) => resolveCaseAssetPath(assetPath, caseAssetsDir)
  });
}
