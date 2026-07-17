import 'dotenv/config';
import { createApp } from './app.js';
import { CmsApiRunner } from './runners/cms-api-runner.js';
import { createProductionRunner } from './runners/production-runner.js';
import { cmsWhitebagCases } from './seed/cms-whitebag-cases.js';
import { createSqliteStore } from './storage/sqlite-store.js';

function requiredCmsConfig() {
  const fields = ['CMS_BASE_URL', 'CMS_AES_KEY', 'CMS_AES_IV', 'CMS_APP_KEY', 'CMS_USERNAME', 'CMS_PASSWORD', 'CMS_OAUTH_ID', 'CMS_OAUTH_TYPE', 'CMS_VERSION'];
  const missing = fields.filter((field) => !process.env[field]);
  if (missing.length) return { missing };
  return {
    config: {
      key: process.env.CMS_AES_KEY,
      iv: process.env.CMS_AES_IV,
      appKey: process.env.CMS_APP_KEY,
      username: process.env.CMS_USERNAME,
      password: process.env.CMS_PASSWORD,
      oauthId: process.env.CMS_OAUTH_ID,
      oauthType: process.env.CMS_OAUTH_TYPE,
      version: process.env.CMS_VERSION
    },
    baseUrl: process.env.CMS_BASE_URL
  };
}

async function main() {
  let webRunner;
  let runnerStatus;
  try {
    webRunner = await createProductionRunner();
    runnerStatus = { ready: true, message: 'Midscene Web runner is ready' };
  } catch (error) {
    webRunner = { execute: async () => { throw error; } };
    runnerStatus = { ready: false, message: error.message };
    console.warn(`Web UI runner is unavailable: ${error.message}`);
  }
  const cmsConfig = requiredCmsConfig();
  const cmsRunnerStatus = cmsConfig.config
    ? { ready: true, message: 'CMS API runner is ready' }
    : { ready: false, message: `missing ${cmsConfig.missing.join(', ')}` };
  const apiRunner = cmsConfig.config
    ? new CmsApiRunner({ config: cmsConfig.config })
    : { execute: async () => { throw new Error(cmsRunnerStatus.message); } };
  const runner = { web: webRunner, api: apiRunner };
  const port = Number(process.env.PORT || 4173);
  const store = createSqliteStore({ databasePath: 'data/novatest.db', legacyJsonPath: 'data/store.json' });
  createApp({ runner, store, runnerStatus, cmsRunnerStatus, cmsSeedCases: cmsConfig.baseUrl ? cmsWhitebagCases({ baseUrl: cmsConfig.baseUrl }) : [] }).listen(port, '127.0.0.1', () => console.log(`NovaTest is running at http://127.0.0.1:${port}`));
}

main();
