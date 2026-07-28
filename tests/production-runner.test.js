import { describe, expect, it, vi } from 'vitest';
import { assertMidsceneConfig, createBrowserFactory, createLighthouseBeforeFirstStep, createMidsceneAgentFactory, resolveBrowserLaunchOptions, resolveCaseAssetPath, resolveMidsceneReplanningCycleLimit } from '../server/runners/production-runner.js';

describe('Midscene configuration', () => {
  it('reports every missing model setting before starting a browser', () => {
    expect(() => assertMidsceneConfig({})).toThrow('MIDSCENE_MODEL_BASE_URL, MIDSCENE_MODEL_API_KEY, MIDSCENE_MODEL_NAME');
  });

  it('accepts a model configuration without an explicit model family', () => {
    expect(() => assertMidsceneConfig({
      MIDSCENE_MODEL_BASE_URL: 'https://model.example/v1',
      MIDSCENE_MODEL_API_KEY: 'key',
      MIDSCENE_MODEL_NAME: 'model'
    })).not.toThrow();
  });

  it('uses a bounded replanning limit and falls back to 40 for invalid configuration', () => {
    expect(resolveMidsceneReplanningCycleLimit({})).toBe(40);
    expect(resolveMidsceneReplanningCycleLimit({ MIDSCENE_REPLANNING_CYCLE_LIMIT: '56' })).toBe(56);
    expect(resolveMidsceneReplanningCycleLimit({ MIDSCENE_REPLANNING_CYCLE_LIMIT: '0' })).toBe(40);
    expect(resolveMidsceneReplanningCycleLimit({ MIDSCENE_REPLANNING_CYCLE_LIMIT: '81' })).toBe(40);
    expect(resolveMidsceneReplanningCycleLimit({ MIDSCENE_REPLANNING_CYCLE_LIMIT: '4.5' })).toBe(40);
  });

  it('passes the resolved replanning limit to every Midscene agent', () => {
    class CapturingAgent {
      constructor(page, options) {
        this.page = page;
        this.options = options;
      }
    }

    const agent = createMidsceneAgentFactory(CapturingAgent, { MIDSCENE_REPLANNING_CYCLE_LIMIT: '56' })({ id: 'page' });

    expect(agent.options).toEqual({ replanningCycleLimit: 56 });
  });

  it('uses a locally configured Chromium executable when the bundled cache is unavailable', () => {
    expect(resolveBrowserLaunchOptions({ PLAYWRIGHT_EXECUTABLE_PATH: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }))
      .toEqual({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  });

  it('resolves only normalized case asset paths inside the configured asset directory', () => {
    expect(resolveCaseAssetPath('case-1/reference.png', '/tmp/case-assets')).toBe('/tmp/case-assets/case-1/reference.png');
    expect(resolveCaseAssetPath('../outside.png', '/tmp/case-assets')).toBeUndefined();
    expect(resolveCaseAssetPath('/tmp/outside.png', '/tmp/case-assets')).toBeUndefined();
  });

  it('relaunches Chromium once when the retained browser is disconnected', async () => {
    const close = vi.fn();
    const page = {};
    const first = { isConnected: () => false };
    const second = {
      isConnected: () => true,
      newContext: async () => ({ newPage: async () => page, close })
    };
    const launch = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const session = await createBrowserFactory({ launch }).openPage({ viewport: { width: 1440, height: 900 } });

    expect(launch).toHaveBeenCalledTimes(2);
    expect(session.page).toBe(page);
    await session.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('replaces the retained browser once after a closed-context error', async () => {
    const page = {};
    const close = vi.fn();
    const first = {
      isConnected: () => true,
      newContext: async () => { throw new Error('Target page, context or browser has been closed'); }
    };
    const second = {
      isConnected: () => true,
      newContext: async () => ({ newPage: async () => page, close })
    };
    const launch = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const session = await createBrowserFactory({ launch }).openPage({ viewport: { width: 1440, height: 900 } });

    expect(launch).toHaveBeenCalledTimes(2);
    expect(session.page).toBe(page);
    await session.close();
  });

  it('runs Lighthouse login only for Web UI cases on the configured project host', async () => {
    const credentials = { email: 'person@example.test', password: 'private-value', totpSecret: 'seed' };
    const readCredentials = vi.fn(() => credentials);
    const login = vi.fn(async () => {});
    const beforeFirstStep = createLighthouseBeforeFirstStep({ env: {}, readCredentials, login });
    const page = {};

    await beforeFirstStep(page, {
      project: { webAuth: { provider: 'lighthouse', host: 'dt.chenmoyuan.tech' } },
      testCase: { target: 'web', baseUrl: 'https://dt.chenmoyuan.tech/dashboard/tasks/my' }
    });
    await beforeFirstStep(page, {
      project: { webAuth: { provider: 'lighthouse', host: 'dt.chenmoyuan.tech' } },
      testCase: { target: 'api', baseUrl: 'https://dt.chenmoyuan.tech/api' }
    });

    expect(readCredentials).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith(page, credentials);
  });
});
