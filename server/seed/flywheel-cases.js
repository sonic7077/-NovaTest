function requestStep(id, instruction, action, options = {}) {
  return {
    id,
    kind: 'apiRequest',
    instruction,
    request: {
      protocol: 'flywheel',
      action,
      method: options.method || 'GET',
      payload: options.payload || {},
      expectedStatus: options.expectedStatus ?? 200,
      safety: options.safety || 'readonly',
      ...(options.expectedJson ? { expectedJson: options.expectedJson } : {}),
      ...(options.extract ? { extract: options.extract } : {}),
      ...(options.poll ? { poll: options.poll } : {}),
      ...(options.auth ? { auth: options.auth } : {})
    }
  };
}

function flywheelCase({ id, name, projectId, baseUrl, steps }) {
  return { id, name, projectId, baseUrl, target: 'api', viewport: 'desktop', steps };
}

function oneStepCase({ id, name, action, projectId, baseUrl, ...options }) {
  return flywheelCase({
    id: `flywheel-${id}`,
    name,
    projectId,
    baseUrl,
    steps: [requestStep(`flywheel-${id}-request`, name, action, options)]
  });
}

const statusExists = [{ path: '$.status', exists: true }];
const itemsExists = [{ path: '$.items', exists: true }];
const successStatuses = [200, 201, 202];
const invalidRequestStatuses = [400, 422];
const unknownResourceStatuses = [404, 422];
const testUserId = '{{platformId}}-novatest-{{runId}}';

export function flywheelCases({ projectId, baseUrl }) {
  const positives = [
    oneStepCase({ id: 'health', name: '正例：飞轮健康检查', action: '/health', projectId, baseUrl, auth: 'none' }),
    oneStepCase({ id: 'health-live', name: '正例：飞轮存活检查', action: '/health/live', projectId, baseUrl, auth: 'none' }),
    oneStepCase({ id: 'metrics', name: '正例：飞轮指标端点可达', action: '/metrics', projectId, baseUrl, auth: 'none' }),
    oneStepCase({ id: 'taxonomy-get', name: '正例：飞轮标签词表查询', action: '/api/v1/taxonomy', projectId, baseUrl, expectedJson: itemsExists }),
    oneStepCase({ id: 'feed-default', name: '正例：飞轮推荐默认分页', action: '/api/v1/feed', projectId, baseUrl, payload: { user_id: testUserId, size: 10 }, expectedJson: itemsExists }),
    oneStepCase({ id: 'feed-min-size', name: '正例：飞轮推荐最小分页', action: '/api/v1/feed', projectId, baseUrl, payload: { user_id: testUserId, size: 1 }, expectedJson: itemsExists }),
    oneStepCase({ id: 'feed-max-size', name: '正例：飞轮推荐最大分页', action: '/api/v1/feed', projectId, baseUrl, payload: { user_id: testUserId, size: 50 }, expectedJson: itemsExists }),
    oneStepCase({ id: 'search-default', name: '正例：飞轮搜索默认分页', action: '/api/v1/search', projectId, baseUrl, payload: { user_id: testUserId, q: '自动化测试', size: 20 }, expectedJson: itemsExists }),
    oneStepCase({ id: 'search-min-size', name: '正例：飞轮搜索最小分页', action: '/api/v1/search', projectId, baseUrl, payload: { user_id: testUserId, q: '测试', size: 1 }, expectedJson: itemsExists }),
    oneStepCase({ id: 'search-max-size', name: '正例：飞轮搜索最大分页', action: '/api/v1/search', projectId, baseUrl, payload: { user_id: testUserId, q: '测试', size: 100 }, expectedJson: itemsExists }),
    flywheelCase({
      id: 'flywheel-ingest-status',
      name: '正例：飞轮内容采集及状态回查',
      projectId,
      baseUrl,
      steps: [
        requestStep('flywheel-ingest', '提交项目专属测试正文到飞轮引擎', '/api/v1/ingest', {
          method: 'POST', safety: 'mutating', expectedStatus: successStatuses,
          payload: { source: 'text', text: 'NovaTest 飞轮引擎自动化验证 {{platformId}}-novatest-{{runId}}', author_id: testUserId },
          expectedJson: [{ path: '$.job_id', exists: true }], extract: { jobId: '$.job_id' }
        }),
        requestStep('flywheel-ingest-status', '查询内容采集异步任务状态', '/api/v1/ingest/{{jobId}}', { expectedJson: statusExists })
      ]
    }),
    flywheelCase({
      id: 'flywheel-content-feedback',
      name: '正例：飞轮内容详情、关联与行为反馈',
      projectId,
      baseUrl,
      steps: [
        requestStep('flywheel-content-ingest', '提交用于详情、关联和反馈验证的项目专属内容', '/api/v1/ingest', {
          method: 'POST', safety: 'mutating', expectedStatus: successStatuses,
          payload: { source: 'text', text: 'NovaTest 飞轮内容闭环验证 {{platformId}}-novatest-{{runId}}', author_id: testUserId },
          expectedJson: [{ path: '$.job_id', exists: true }], extract: { jobId: '$.job_id' }
        }),
        requestStep('flywheel-content-status', '轮询内容采集状态直到终态', '/api/v1/ingest/{{jobId}}', {
          expectedJson: statusExists,
          poll: { path: '$.status', values: ['done', 'dup', 'blocked', 'failed'], intervalMs: 1_000, maxAttempts: 20 },
          extract: { contentId: '$.content_id' }
        }),
        requestStep('flywheel-content-detail', '查询刚采集内容的详情', '/api/v1/content/{{contentId}}', {
          expectedJson: [{ path: '$.content_id', equalsVariable: 'contentId' }]
        }),
        requestStep('flywheel-content-related', '查询刚采集内容的关联内容', '/api/v1/content/{{contentId}}/related', {
          payload: { size: 6 }, expectedJson: itemsExists
        }),
        requestStep('flywheel-content-feedback', '上报刚采集内容的正向行为反馈', '/api/v1/feedback', {
          method: 'POST', safety: 'mutating',
          payload: { user_id: testUserId, content_id: '{{contentId}}', session_id: '{{runId}}', event: 'like' },
          expectedJson: [{ path: '$.ok', equals: true }]
        })
      ]
    }),
    oneStepCase({ id: 'user-upsert', name: '正例：飞轮用户建档', action: `/api/v1/users/${testUserId}`, projectId, baseUrl, method: 'PUT', safety: 'mutating', payload: { onboarding_tags: ['自动化测试', '质量工程'], region: 'CN' }, expectedJson: [{ path: '$.ok', equals: true }] }),
    oneStepCase({ id: 'taxonomy-import', name: '正例：飞轮标签词表导入', action: '/api/v1/taxonomy', projectId, baseUrl, method: 'POST', safety: 'mutating', payload: { version: '{{random6}}', tags: [{ tag_id: '{{platformId}}-novatest-{{runId}}', name: '自动化验证', dimension: '测试' }] }, expectedJson: [{ path: '$.ok', equals: true }] })
  ];

  const negatives = [
    oneStepCase({ id: 'feed-missing-key', name: '反例：飞轮推荐缺少平台密钥', action: '/api/v1/feed', projectId, baseUrl, auth: 'none', expectedStatus: 401 }),
    oneStepCase({ id: 'feed-invalid-key', name: '反例：飞轮推荐错误平台密钥', action: '/api/v1/feed', projectId, baseUrl, auth: 'invalid', expectedStatus: 401 }),
    oneStepCase({ id: 'feed-missing-user', name: '反例：飞轮推荐缺少用户标识', action: '/api/v1/feed', projectId, baseUrl, payload: {}, expectedStatus: invalidRequestStatuses }),
    oneStepCase({ id: 'feed-size-zero', name: '反例：飞轮推荐分页为零', action: '/api/v1/feed', projectId, baseUrl, payload: { user_id: testUserId, size: 0 }, expectedStatus: invalidRequestStatuses }),
    oneStepCase({ id: 'feed-size-overflow', name: '反例：飞轮推荐分页超过上限', action: '/api/v1/feed', projectId, baseUrl, payload: { user_id: testUserId, size: 51 }, expectedStatus: invalidRequestStatuses }),
    oneStepCase({ id: 'search-missing-user', name: '反例：飞轮搜索缺少用户标识', action: '/api/v1/search', projectId, baseUrl, payload: { q: '测试' }, expectedStatus: invalidRequestStatuses }),
    oneStepCase({ id: 'search-missing-query', name: '反例：飞轮搜索缺少关键词', action: '/api/v1/search', projectId, baseUrl, payload: { user_id: testUserId }, expectedStatus: invalidRequestStatuses }),
    oneStepCase({ id: 'search-empty-query', name: '反例：飞轮搜索空关键词', action: '/api/v1/search', projectId, baseUrl, payload: { user_id: testUserId, q: '' }, expectedStatus: invalidRequestStatuses }),
    oneStepCase({ id: 'search-long-query', name: '反例：飞轮搜索超长关键词', action: '/api/v1/search', projectId, baseUrl, payload: { user_id: testUserId, q: '测'.repeat(513) }, expectedStatus: invalidRequestStatuses }),
    oneStepCase({ id: 'search-size-zero', name: '反例：飞轮搜索分页为零', action: '/api/v1/search', projectId, baseUrl, payload: { user_id: testUserId, q: '测试', size: 0 }, expectedStatus: invalidRequestStatuses }),
    oneStepCase({ id: 'search-size-overflow', name: '反例：飞轮搜索分页超过上限', action: '/api/v1/search', projectId, baseUrl, payload: { user_id: testUserId, q: '测试', size: 101 }, expectedStatus: invalidRequestStatuses }),
    oneStepCase({ id: 'content-not-found', name: '反例：飞轮未知内容详情', action: '/api/v1/content/{{platformId}}-novatest-missing', projectId, baseUrl, expectedStatus: unknownResourceStatuses }),
    oneStepCase({ id: 'related-not-found', name: '反例：飞轮未知内容关联查询', action: '/api/v1/content/{{platformId}}-novatest-missing/related', projectId, baseUrl, payload: { size: 6 }, expectedStatus: unknownResourceStatuses }),
    oneStepCase({ id: 'ingest-invalid-job', name: '反例：飞轮非法采集任务标识', action: '/api/v1/ingest/invalid-job-id', projectId, baseUrl, expectedStatus: unknownResourceStatuses })
  ];

  return [...positives, ...negatives];
}

export function seedFlywheelCases(store, { baseUrl, platformId }) {
  const project = store.listProjects().find((item) => item.name === '飞轮引擎');
  if (!project || !baseUrl || !platformId) return 0;
  const cases = flywheelCases({ projectId: project.id, baseUrl, platformId });
  cases.forEach((testCase) => store.saveCase(testCase));
  return cases.length;
}
