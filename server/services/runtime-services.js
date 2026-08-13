import { CmsApiRunner } from '../runners/cms-api-runner.js';
import { EditorialApiRunner } from '../runners/editorial-api-runner.js';
import { FlywheelApiRunner } from '../runners/flywheel-api-runner.js';
import { DaygfApiRunner } from '../runners/daygf-api-runner.js';
import { CompositeApiRunner } from '../runners/composite-api-runner.js';
import { createProductionRunner } from '../runners/production-runner.js';
import { normalizeRuntimeConfig } from './runtime-config-service.js';
import { createModelConfigManager } from './model-config-manager.js';
import { createReloadableWebRunner } from './reloadable-web-runner.js';

function unavailableRunner(message) {
  return { execute: async () => { throw new Error(message); } };
}

export async function createRuntimeServices({ runtimeConfig, store, createWebRunner = createProductionRunner, CmsRunner = CmsApiRunner, EditorialRunner = EditorialApiRunner, FlywheelRunner = FlywheelApiRunner, DaygfRunner = DaygfApiRunner, ApiRunner = CompositeApiRunner } = {}) {
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
      flywheelRunnerStatus: { ready: false, message },
      daygfRunnerStatus: { ready: false, message },
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
  const cmsRunnerStatus = { ready: false, message: 'CMS API runner is unavailable' };
  let cmsRunner;
  try {
    cmsRunner = new CmsRunner({ config: config.cms });
    cmsRunnerStatus.ready = true;
    cmsRunnerStatus.message = 'CMS API runner is ready';
  } catch (error) {
    cmsRunner = unavailableRunner(error.message);
    cmsRunnerStatus.message = error.message;
  }
  const editorialRunnerStatus = { ready: false, message: 'Editorial API runner is not configured' };
  let editorialRunner = unavailableRunner(editorialRunnerStatus.message);
  if (config.editorial) {
    try {
      editorialRunner = new EditorialRunner({ config: config.editorial });
      editorialRunnerStatus.ready = true;
      editorialRunnerStatus.message = 'Editorial API runner is ready';
    } catch (error) {
      editorialRunner = unavailableRunner(error.message);
      editorialRunnerStatus.message = error.message;
    }
  }
  const flywheelRunnerStatus = { ready: false, message: 'Flywheel API runner is not configured' };
  let flywheelRunner = unavailableRunner(flywheelRunnerStatus.message);
  if (config.flywheel) {
    try {
      flywheelRunner = new FlywheelRunner({ config: config.flywheel });
      flywheelRunnerStatus.ready = true;
      flywheelRunnerStatus.message = 'Flywheel API runner is ready';
    } catch (error) {
      flywheelRunner = unavailableRunner(error.message);
      flywheelRunnerStatus.message = error.message;
    }
  }
  const daygfRunnerStatus = { ready: false, message: 'Daygf API runner is not configured' };
  let daygfRunner = unavailableRunner(daygfRunnerStatus.message);
  if (config.daygf) {
    try {
      daygfRunner = new DaygfRunner({ config: config.daygf });
      daygfRunnerStatus.ready = true;
      daygfRunnerStatus.message = 'Daygf API runner is ready';
    } catch (error) {
      daygfRunner = unavailableRunner(error.message);
      daygfRunnerStatus.message = error.message;
    }
  }
  const apiRunner = new ApiRunner({ cms: cmsRunner, editorial: editorialRunner, flywheel: flywheelRunner, daygf: daygfRunner });

  return {
    runner: { web: reloadableWebRunner, api: apiRunner },
    runnerStatus,
    cmsRunnerStatus,
    editorialRunnerStatus,
    flywheelRunnerStatus,
    daygfRunnerStatus,
    modelConfigManager: createModelConfigManager({
      store,
      runtimeConfig: config,
      createRunner: createWebRunner,
      runner: reloadableWebRunner,
      runnerStatus
    }),
    cmsBaseUrl: config.cms.baseUrl,
    editorialBaseUrl: config.editorial?.baseUrl,
    flywheelBaseUrl: config.flywheel?.baseUrl,
    flywheelPlatformId: config.flywheel?.platformId,
    daygfBaseUrl: config.daygf?.baseUrl
  };
}
