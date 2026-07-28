import { mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { shouldUseLighthouseLogin } from '../domain/project-auth.js';
import { loginLighthouse, readLighthouseCredentials } from '../services/lighthouse-login.js';
import { createWebRunner } from './web-runner.js';

const requiredSettings = [
  'MIDSCENE_MODEL_BASE_URL',
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_NAME'
];
const defaultReplanningCycleLimit = 40;
const minReplanningCycleLimit = 1;
const maxReplanningCycleLimit = 80;

export function assertMidsceneConfig(env) {
  const missing = requiredSettings.filter((name) => !env[name]);
  if (missing.length) throw new Error(`missing Midscene configuration: ${missing.join(', ')}`);
}

export function resolveBrowserLaunchOptions(env) {
  const executablePath = String(env.PLAYWRIGHT_EXECUTABLE_PATH || '').trim();
  return executablePath ? { headless: true, executablePath } : { headless: true };
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

  return {
    async openPage({ viewport }) {
      let browser = await currentBrowser();
      try {
        const context = await browser.newContext({ viewport });
        return { page: await context.newPage(), close: () => context.close() };
      } catch (error) {
        if (!isClosedBrowserError(error)) throw error;
        instance = undefined;
        browser = await currentBrowser();
        const context = await browser.newContext({ viewport });
        return { page: await context.newPage(), close: () => context.close() };
      }
    }
  };
}

export function createLighthouseBeforeFirstStep({ env = process.env, readCredentials = readLighthouseCredentials, login = loginLighthouse } = {}) {
  return async (page, context) => {
    if (!shouldUseLighthouseLogin(context.project, context.testCase)) return;
    await login(page, readCredentials(env));
  };
}

export async function createProductionRunner({ env = process.env, screenshotDir = 'data/evidence', caseAssetsDir = join(process.cwd(), 'data/case-assets'), beforeFirstStep = createLighthouseBeforeFirstStep({ env }) } = {}) {
  assertMidsceneConfig(env);
  const [{ chromium }, { PlaywrightAgent }] = await Promise.all([
    import('playwright'),
    import('@midscene/web/playwright')
  ]);
  await mkdir(screenshotDir, { recursive: true });
  const browser = createBrowserFactory({ launch: () => chromium.launch(resolveBrowserLaunchOptions(env)) });

  return createWebRunner({
    browser,
    agentFactory: createMidsceneAgentFactory(PlaywrightAgent, env),
    beforeFirstStep,
    screenshotDir,
    resolveAssetPath: (assetPath) => resolveCaseAssetPath(assetPath, caseAssetsDir)
  });
}
