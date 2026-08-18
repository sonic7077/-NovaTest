function requestStep(id, instruction, action, options = {}) {
  return {
    id,
    kind: 'apiRequest',
    instruction,
    request: {
      protocol: 'by',
      action,
      method: options.method || 'GET',
      payload: options.payload || {},
      expectedStatus: options.expectedStatus ?? 200,
      expectedCode: options.expectedCode ?? 0,
      safety: options.safety || 'readonly',
      auth: 'none',
      ...(options.expectedJson ? { expectedJson: options.expectedJson } : {}),
      ...(options.extract ? { extract: options.extract } : {})
    }
  };
}

function apiCase({ id, name, projectId, baseUrl, steps }) {
  return { id, name, projectId, baseUrl, target: 'api', viewport: 'desktop', steps };
}

function singleCase(module, index, definition, projectId, baseUrl) {
  const id = `by-${module}-${String(index + 1).padStart(2, '0')}`;
  return apiCase({
    id,
    name: `${definition.priority || 'P1'} ${definition.positive === false ? '反例' : '正例'}：BY-${definition.name}`,
    projectId,
    baseUrl,
    steps: [requestStep(`${id}-request`, definition.name, definition.action, definition)]
  });
}

const listEnvelope = [{ path: '$.data.list', exists: true }];
const objectEnvelope = [{ path: '$.data', exists: true }];

const memberCases = [
  { priority: 'P0', name: '会员列表默认分页查询', action: '/c-api/v1/members', payload: { page: 1, pageSize: 10 }, expectedJson: [...listEnvelope, { path: '$.data.total', exists: true }] },
  { priority: 'P1', name: '会员列表零页码回退', action: '/c-api/v1/members', payload: { page: 0, pageSize: 10 }, expectedJson: listEnvelope },
  { priority: 'P1', name: '会员列表超大页大小回退', action: '/c-api/v1/members', payload: { page: 1, pageSize: 61 }, expectedJson: listEnvelope },
  { priority: 'P1', name: '会员列表组合条件筛选', action: '/c-api/v1/members', payload: { province: '广东', city: '深圳', ageMin: 18, ageMax: 30, heightMin: 155, heightMax: 180, page: 1, pageSize: 10 }, expectedJson: listEnvelope },
  { priority: 'P0', name: '会员列表至公开资料详情链路', action: '/c-api/v1/members', payload: { page: 1, pageSize: 1 }, expectedJson: listEnvelope, extract: { memberPubId: '$.data.list[0].pubId' } },
  { priority: 'P1', positive: false, name: '不存在会员资料拒绝', action: '/c-api/v1/members/not-a-public-member', expectedCode: 40400 },
  { priority: 'P1', positive: false, name: '无效图片访问令牌拒绝', action: '/c-api/v1/images/not-a-valid-image-reference', expectedStatus: [200, 403], expectedCode: 40300 },
  { priority: 'P1', name: '会员列表状态参数不泄露下架资料', action: '/c-api/v1/members', payload: { status: 0, page: 1, pageSize: 10 }, expectedJson: listEnvelope }
];

const contentCases = [
  { priority: 'P0', name: '文章列表默认分页查询', action: '/c-api/v1/articles', payload: { page: 1, pageSize: 10 }, expectedJson: [...listEnvelope, { path: '$.data.total', exists: true }] },
  { priority: 'P1', name: '文章列表按分类查询', action: '/c-api/v1/articles', payload: { category: '平台公告', page: 1, pageSize: 10 }, expectedJson: listEnvelope },
  { priority: 'P1', name: '文章列表最大分页查询', action: '/c-api/v1/articles', payload: { page: 1, pageSize: 100 }, expectedJson: listEnvelope },
  { priority: 'P0', name: '文章列表至详情链路', action: '/c-api/v1/articles', payload: { page: 1, pageSize: 1 }, expectedJson: listEnvelope, extract: { articleId: '$.data.list[0].id' } },
  { priority: 'P1', positive: false, name: '非法文章编号拒绝', action: '/c-api/v1/articles/0', expectedCode: 40000 },
  { priority: 'P1', positive: false, name: '不存在文章拒绝', action: '/c-api/v1/articles/999999999', expectedCode: 40400 },
  { priority: 'P0', name: '公告默认查询', action: '/c-api/v1/notices', payload: { limit: 10 }, expectedJson: listEnvelope },
  { priority: 'P1', name: '公告超大限制回退', action: '/c-api/v1/notices', payload: { category: '活动公告', limit: 51 }, expectedJson: listEnvelope }
];

const configCases = [
  { priority: 'P0', name: '客服配置查询', action: '/c-api/v1/contact', expectedJson: objectEnvelope },
  { priority: 'P0', name: '上架会员地区查询', action: '/c-api/v1/regions', expectedJson: listEnvelope },
  { priority: 'P0', name: '友情链接查询', action: '/c-api/v1/friend-links', expectedJson: listEnvelope },
  { priority: 'P0', name: 'H5站点信息查询', action: '/c-api/v1/site-info', expectedJson: [...objectEnvelope, { path: '$.data.title', exists: true }] },
  { priority: 'P0', name: '落地页配置查询', action: '/c-api/v1/landing-page', expectedJson: [...objectEnvelope, { path: '$.data.siteName', exists: true }] },
  { priority: 'P0', name: '回家的路配置查询', action: '/c-api/v1/home-road', expectedJson: [...objectEnvelope, { path: '$.data.appEnabled', exists: true }] },
  { priority: 'P1', name: '落地页启用线路字段契约', action: '/c-api/v1/landing-page', expectedJson: [{ path: '$.data.lines', exists: true }] }
];

function chainedCase({ id, name, projectId, baseUrl, first, detail }) {
  return apiCase({
    id,
    name,
    projectId,
    baseUrl,
    steps: [
      requestStep(`${id}-list`, first.instruction, first.action, first.options),
      requestStep(`${id}-detail`, detail.instruction, detail.action, detail.options)
    ]
  });
}

function memberDetailCase(projectId, baseUrl) {
  return chainedCase({
    id: 'by-member-09',
    name: 'P0 正例：BY-会员公开资料详情校验',
    projectId,
    baseUrl,
    first: {
      instruction: '查询上架会员并提取公开标识', action: '/c-api/v1/members',
      options: { payload: { page: 1, pageSize: 1 }, expectedJson: listEnvelope, extract: { memberPubId: '$.data.list[0].pubId' } }
    },
    detail: {
      instruction: '使用公开标识查询会员详情', action: '/c-api/v1/members/{{memberPubId}}',
      options: { expectedJson: [...objectEnvelope, { path: '$.data.pubId', equalsVariable: 'memberPubId' }] }
    }
  });
}

function articleDetailCase(projectId, baseUrl) {
  return chainedCase({
    id: 'by-content-09',
    name: 'P0 正例：BY-文章详情校验',
    projectId,
    baseUrl,
    first: {
      instruction: '查询已发布文章并提取编号', action: '/c-api/v1/articles',
      options: { payload: { page: 1, pageSize: 1 }, expectedJson: listEnvelope, extract: { articleId: '$.data.list[0].id' } }
    },
    detail: {
      instruction: '使用文章编号查询详情', action: '/c-api/v1/articles/{{articleId}}',
      options: { expectedJson: [...objectEnvelope, { path: '$.data.id', equalsVariable: 'articleId' }, { path: '$.data.content', exists: true }] }
    }
  });
}

function reportCases(projectId, baseUrl) {
  const missing = singleCase('report', 0, {
    priority: 'P1', positive: false, name: '举报缺少会员标识拒绝', action: '/c-api/v1/reports', method: 'POST', payload: { reason: '资料不实' }, expectedCode: 40000
  }, projectId, baseUrl);
  const overlong = singleCase('report', 1, {
    priority: 'P1', positive: false, name: '举报原因超长拒绝', action: '/c-api/v1/reports', method: 'POST', payload: { pubId: 'not-a-public-member', reason: 'x'.repeat(65) }, expectedCode: 40000
  }, projectId, baseUrl);
  const unknown = singleCase('report', 2, {
    priority: 'P1', positive: false, name: '举报不存在会员拒绝', action: '/c-api/v1/reports', method: 'POST', payload: { pubId: 'not-a-public-member', reason: '资料不实' }, expectedCode: 40400
  }, projectId, baseUrl);
  const success = chainedCase({
    id: 'by-report-04',
    name: 'P2 受控操作：BY-提交有效会员举报',
    projectId,
    baseUrl,
    first: {
      instruction: '查询上架会员并提取公开标识', action: '/c-api/v1/members',
      options: { payload: { page: 1, pageSize: 1 }, expectedJson: listEnvelope, extract: { memberPubId: '$.data.list[0].pubId' } }
    },
    detail: {
      instruction: '提交受控举报请求', action: '/c-api/v1/reports',
      options: { method: 'POST', payload: { targetType: 'member', pubId: '{{memberPubId}}', reason: '自动化回归验证', detail: '自动化平台受控测试数据' }, expectedJson: [{ path: '$.data.status', equals: 'pending' }], safety: 'mutating' }
    }
  });
  return [missing, overlong, unknown, success];
}

export function byCases({ projectId, baseUrl }) {
  const member = memberCases.map((definition, index) => singleCase('member', index, definition, projectId, baseUrl));
  const content = contentCases.map((definition, index) => singleCase('content', index, definition, projectId, baseUrl));
  const config = configCases.map((definition, index) => singleCase('config', index, definition, projectId, baseUrl));
  return [...member, memberDetailCase(projectId, baseUrl), ...content, articleDetailCase(projectId, baseUrl), ...config, ...reportCases(projectId, baseUrl)];
}

export function seedByCases(store, { projectId, baseUrl }) {
  if (!projectId || !baseUrl || !store.getProject(projectId)) return 0;
  const cases = byCases({ projectId, baseUrl });
  cases.forEach((testCase) => store.saveCase(testCase));
  return cases.length;
}
