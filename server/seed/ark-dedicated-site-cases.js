const WRITE_SKIP_REASON = '专属站点建稿/更新需独立授权';

function requestStep(id, instruction, action, payload = {}, options = {}) {
  return {
    id,
    kind: 'apiRequest',
    instruction,
    request: {
      action, method: 'POST', payload, expectedStatus: options.expectedStatus ?? 1,
      safety: options.safety || 'readonly',
      ...(options.auth ? { auth: options.auth } : {}),
      ...(options.expectedJson ? { expectedJson: options.expectedJson } : {}),
      ...(options.skipReason ? { skipReason: options.skipReason } : {})
    }
  };
}

function apiCase({ id, name, projectId, baseUrl, steps }) {
  return { id, name, projectId, baseUrl, target: 'api', viewport: 'desktop', steps };
}

function writeStep(id, instruction, payload) {
  return requestStep(id, instruction, 'create_update', payload, {
    safety: 'mutating', skipReason: WRITE_SKIP_REASON
  });
}

export function arkDedicatedSiteCases({ projectId, baseUrl }) {
  const common = { projectId, baseUrl };
  return [
    apiCase({ ...common, id: 'ark-dedicated-project-discovery', name: 'P0 专属站点-CMS项目线路发现', steps: [
      requestStep('project-list', '以未登录状态调用 project_list，确认返回项目码与 API 线路。', 'project_list', {}, { auth: 'none' })
    ] }),
    apiCase({ ...common, id: 'ark-dedicated-config-categories', name: 'P0 专属站点-CMS分类配置读取', steps: [
      requestStep('category-config', '登录后读取 config，确认返回 AI 自动分类使用的 category_list。', 'config', {}, { expectedJson: [{ path: '$.data.category_list', exists: true }] })
    ] }),
    apiCase({ ...common, id: 'ark-dedicated-auth-reuse', name: 'P0 专属站点-CMS登录令牌复用', steps: [
      requestStep('config-first', '首次读取 config，建立 CMS 登录会话。', 'config', {}, { expectedJson: [{ path: '$.data.category_list', exists: true }] }),
      requestStep('config-reused', '再次读取 config，确认同一用例会话可复用登录令牌。', 'config', {}, { expectedJson: [{ path: '$.data.category_list', exists: true }] })
    ] }),
    apiCase({ ...common, id: 'ark-dedicated-create-missing-title', name: 'P1 反例：专属站点-建稿缺失标题', steps: [
      writeStep('create-without-title', '以缺失标题参数调用 create_update，确认站点拒绝不完整建稿。', { body: '自动化契约反例', cover: 'https://imgpublic.ycomesc.live/test.jpg', is_draft: 1, status: 0 })
    ] }),
    apiCase({ ...common, id: 'ark-dedicated-create-missing-cover', name: 'P1 反例：专属站点-建稿缺失封面', steps: [
      writeStep('create-without-cover', '以缺失封面参数调用 create_update，确认站点拒绝不完整建稿。', { title: '自动化契约反例', body: '自动化契约反例', is_draft: 1, status: 0 })
    ] }),
    apiCase({ ...common, id: 'ark-dedicated-create-draft-media', name: 'P1 专属站点-草稿媒体字段契约', steps: [
      writeStep('create-draft-media', '创建带图片 Markdown 与 dplayer 视频标签的草稿，确认草稿字段、分类和媒体格式可被 CMS 接收。', { title: '自动化专属站点草稿 {{random6}}', body: '## 自动化标题\n\n![配图](https://imgpublic.ycomesc.live/test.jpg)\n\n[dplayer url="https://video.iwanna.tv/test.m3u8" pic="https://imgpublic.ycomesc.live/test.jpg" /]', cover: 'https://imgpublic.ycomesc.live/test.jpg', keyword: '自动化,专属站点', tags: '自动化,专属站点', category_id: '1', is_draft: 1, status: 0, desc: '' })
    ] }),
    apiCase({ ...common, id: 'ark-dedicated-update-article', name: 'P1 专属站点-文章更新参数契约', steps: [
      writeStep('update-article', '以指定文章编号调用 create_update，确认更新模式传递 id、草稿状态和正文参数。', { id: 0, title: '自动化更新契约 {{random6}}', body: '自动化更新契约正文', cover: 'https://imgpublic.ycomesc.live/test.jpg', is_draft: 1, status: 0, desc: '' })
    ] })
  ];
}

export function seedArkDedicatedSiteCases(store, { baseUrl }) {
  const project = store.listProjects().find((item) => item.name === '方舟社区发帖');
  if (!project || !baseUrl) return 0;
  const cases = arkDedicatedSiteCases({ projectId: project.id, baseUrl });
  cases.forEach((testCase) => store.saveCase(testCase));
  return cases.length;
}
