import 'dotenv/config';
import { createApp } from './app.js';
import { CmsApiRunner } from './runners/cms-api-runner.js';
import { seedArkCommunityCases } from './seed/ark-community-cases.js';
import { upgradeLighthouseTaskListCase } from './seed/lighthouse-cases.js';
import { createProductionRunner } from './runners/production-runner.js';
import { cmsWhitebagCases } from './seed/cms-whitebag-cases.js';
import { createSqliteStore } from './storage/sqlite-store.js';
import { publicMidsceneConfig, withWujiMidsceneConfig } from './services/midscene-config.js';

function requiredCmsConfig() {
  const fields = ['CMS_BASE_URL', 'CMS_AES_KEY', 'CMS_AES_IV', 'CMS_APP_KEY', 'CMS_USERNAME', 'CMS_PASSWORD', 'CMS_GOOGLE_SECRET', 'CMS_OAUTH_ID', 'CMS_OAUTH_TYPE', 'CMS_VERSION', 'CMS_BUNDLE_ID', 'CMS_LANGUAGE', 'CMS_VIA'];
  const missing = fields.filter((field) => !process.env[field]);
  if (missing.length) return { missing };
  return {
    config: {
      key: process.env.CMS_AES_KEY,
      iv: process.env.CMS_AES_IV,
      appKey: process.env.CMS_APP_KEY,
      username: process.env.CMS_USERNAME,
      password: process.env.CMS_PASSWORD,
      googleSecret: process.env.CMS_GOOGLE_SECRET,
      oauthId: process.env.CMS_OAUTH_ID,
      oauthType: process.env.CMS_OAUTH_TYPE,
      version: process.env.CMS_VERSION,
      bundleId: process.env.CMS_BUNDLE_ID,
      language: process.env.CMS_LANGUAGE,
      via: process.env.CMS_VIA
    },
    baseUrl: process.env.CMS_BASE_URL
  };
}

async function main() {
  const modelEnv = withWujiMidsceneConfig(process.env);
  Object.assign(process.env, modelEnv);
  const store = createSqliteStore({ databasePath: 'data/novatest.db', legacyJsonPath: 'data/store.json' });
  store.ensureProjectWebAuth({
    name: process.env.LIGHTHOUSE_PROJECT_NAME || '默认项目',
    webAuth: { provider: 'lighthouse', host: 'dt.chenmoyuan.tech' }
  });
  upgradeLighthouseTaskListCase(store);
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
  const host = process.env.HOST || '127.0.0.1';
  if (cmsConfig.baseUrl) seedArkCommunityCases(store, { baseUrl: cmsConfig.baseUrl });
  createApp({ runner, store, authRequired: true, runnerStatus, cmsRunnerStatus, modelConfig: publicMidsceneConfig(modelEnv), cmsSeedCases: cmsConfig.baseUrl ? cmsWhitebagCases({ baseUrl: cmsConfig.baseUrl }) : [] }).listen(port, host, () => console.log(`先锋营自动化测试平台运行于 http://${host}:${port}`));
}

main();
