import { mkdir } from 'node:fs/promises';
import { createWebRunner } from './web-runner.js';

const requiredSettings = [
  'MIDSCENE_MODEL_BASE_URL',
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_NAME',
  'MIDSCENE_MODEL_FAMILY'
];

export function assertMidsceneConfig(env) {
  const missing = requiredSettings.filter((name) => !env[name]);
  if (missing.length) throw new Error(`missing Midscene configuration: ${missing.join(', ')}`);
}

export async function createProductionRunner({ env = process.env, screenshotDir = 'data/evidence' } = {}) {
  assertMidsceneConfig(env);
  const [{ chromium }, { PlaywrightAgent }] = await Promise.all([
    import('playwright'),
    import('@midscene/web/playwright')
  ]);
  await mkdir(screenshotDir, { recursive: true });
  const browserInstance = await chromium.launch({ headless: true });
  const browser = {
    async newPage({ viewport }) {
      const context = await browserInstance.newContext({ viewport });
      const page = await context.newPage();
      return page;
    }
  };

  return createWebRunner({
    browser,
    agentFactory: (page) => new PlaywrightAgent(page),
    screenshotDir
  });
}
