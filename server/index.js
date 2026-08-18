import { createApp } from './app.js';
import { seedArkCommunityCases } from './seed/ark-community-cases.js';
import { upgradeLighthouseReadonlyCase, upgradeLighthouseTaskListCase } from './seed/lighthouse-cases.js';
import { cmsWhitebagCases } from './seed/cms-whitebag-cases.js';
import { seedArkAiCommentReviewCases } from './seed/ark-ai-comment-review-cases.js';
import { seedFlywheelCases } from './seed/flywheel-cases.js';
import { seedDaygfCases } from './seed/daygf-cases.js';
import { seedByCases } from './seed/by-cases.js';
import { createSqliteStore } from './storage/sqlite-store.js';
import { createRuntimeServices } from './services/runtime-services.js';

async function main() {
  const store = createSqliteStore({ databasePath: 'data/novatest.db', legacyJsonPath: 'data/store.json' });
  const runtimeConfig = store.getRuntimeConfig();
  store.ensureProjectWebAuth({
    name: runtimeConfig?.lighthouse?.projectName || '默认项目',
    webAuth: { provider: 'lighthouse', host: 'dt.chenmoyuan.tech' }
  });
  upgradeLighthouseTaskListCase(store);
  upgradeLighthouseReadonlyCase(store);
  const services = await createRuntimeServices({ runtimeConfig, store });
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  if (services.cmsBaseUrl) seedArkCommunityCases(store, { baseUrl: services.cmsBaseUrl });
  if (services.editorialBaseUrl) seedArkAiCommentReviewCases(store, { baseUrl: services.editorialBaseUrl });
  if (services.flywheelBaseUrl) {
    const flywheelProject = store.listProjects().find((project) => project.name === '飞轮引擎') || store.saveProject({ name: '飞轮引擎' });
    seedFlywheelCases(store, {
      baseUrl: services.flywheelBaseUrl,
      platformId: services.flywheelPlatformId,
      projectId: flywheelProject.id
    });
  }
  if (services.daygfBaseUrl) {
    const daygfProject = store.listProjects().find((project) => project.name === '一日女友') || store.saveProject({ name: '一日女友' });
    seedDaygfCases(store, { baseUrl: services.daygfBaseUrl, projectId: daygfProject.id });
  }
  const byProject = store.listProjects().find((project) => project.name === 'BY项目') || store.saveProject({ name: 'BY项目' });
  seedByCases(store, { projectId: byProject.id, baseUrl: 'https://by.chenmoyuan.tech' });
  createApp({ ...services, store, authRequired: true, cmsSeedCases: services.cmsBaseUrl ? cmsWhitebagCases({ baseUrl: services.cmsBaseUrl }) : [] }).listen(port, host, () => console.log(`先锋营自动化测试平台运行于 http://${host}:${port}`));
}

main();
