import { CmsApiRunner } from '../runners/cms-api-runner.js';
import { createProductionRunner } from '../runners/production-runner.js';
import { normalizeRuntimeConfig } from './runtime-config-service.js';
import { createModelConfigManager } from './model-config-manager.js';
import { createReloadableWebRunner } from './reloadable-web-runner.js';

function unavailableRunner(message) {
  return { execute: async () => { throw new Error(message); } };
}

export async function createRuntimeServices({ runtimeConfig, store, createWebRunner = createProductionRunner, CmsRunner = CmsApiRunner } = {}) {
  let config;
  try {
    config = normalizeRuntimeConfig(runtimeConfig || store?.getRuntimeConfig?.());
  } catch (error) {
    const message = runtimeConfig || store?.getRuntimeConfig?.()
      ? error.message
      : 'SQLite runtime configuration is unavailable';
    return {
      runner: { web: unavailableRunner(message), api: unavailableRunner(message) },
      runnerStatus: { ready: false, message },
      cmsRunnerStatus: { ready: false, message },
      modelConfigManager: createModelConfigManager({ store, runtimeConfig: undefined, createRunner: createWebRunner, runner: { replace: async () => undefined }, runnerStatus: { ready: false, message } }),
      cmsBaseUrl: undefined
    };
  }

  const runnerStatus = { ready: false, message: 'Midscene Web runner is unavailable' };
  let webRunner;
  try {
    webRunner = await createWebRunner({ modelConfig: config.model, lighthouseCredentials: config.lighthouse });
    runnerStatus.ready = true;
    runnerStatus.message = 'Midscene Web runner is ready';
  } catch (error) {
    runnerStatus.message = error.message;
    webRunner = unavailableRunner(error.message);
  }

  const reloadableWebRunner = createReloadableWebRunner({ current: webRunner });
  let apiRunner;
  const cmsRunnerStatus = { ready: false, message: 'CMS API runner is unavailable' };
  try {
    apiRunner = new CmsRunner({ config: config.cms });
    cmsRunnerStatus.ready = true;
    cmsRunnerStatus.message = 'CMS API runner is ready';
  } catch (error) {
    apiRunner = unavailableRunner(error.message);
    cmsRunnerStatus.message = error.message;
  }

  return {
    runner: { web: reloadableWebRunner, api: apiRunner },
    runnerStatus,
    cmsRunnerStatus,
    modelConfigManager: createModelConfigManager({
      store,
      runtimeConfig: config,
      createRunner: createWebRunner,
      runner: reloadableWebRunner,
      runnerStatus
    }),
    cmsBaseUrl: config.cms.baseUrl
  };
}
