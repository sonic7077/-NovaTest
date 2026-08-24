function requestStep(id, instruction, action, options = {}) {
  return {
    id,
    kind: 'apiRequest',
    instruction,
    request: {
      protocol: 'editorial',
      action,
      method: options.method || 'GET',
      payload: options.payload || {},
      expectedStatus: options.expectedStatus ?? 200,
      safety: options.safety || 'readonly',
      ...(options.expectedJson ? { expectedJson: options.expectedJson } : {}),
      ...(options.extract ? { extract: options.extract } : {}),
      ...(options.select ? { select: options.select } : {}),
      ...(options.auth ? { auth: options.auth } : {})
    }
  };
}

function editorialCase({ id, name, projectId, baseUrl, steps }) {
  return { id, name, projectId, baseUrl, target: 'api', viewport: 'desktop', steps };
}

function reviewCase({ id, name, action, status, projectId, baseUrl }) {
  return editorialCase({
    id,
    name,
    projectId,
    baseUrl,
    steps: [
      requestStep(`${id}-select`, '查询并选择待人工审核的 AI 评论', 'ai-comment-review/list', {
        payload: { status: 'manual_review', source: 'ai', page: 1, limit: 20 },
        expectedJson: [{ path: '$.items', exists: true }],
        select: {
          listPath: '$.items', variable: 'commentId', idPath: '$.id',
          extract: { cmsCommentId: '$.cms_comment_id' }
        }
      }),
      requestStep(`${id}-${action}`, action === 'approve' ? '人工通过所选评论' : '人工驳回所选评论', 'ai-comment-review/action', {
        method: 'POST',
        payload: { action, comment_ids: ['{{commentId}}'] },
        safety: 'mutating',
        expectedJson: [{ path: '$.status', equals: 'ok' }, { path: '$.synced', exists: true }]
      }),
      requestStep(`${id}-verify`, '按评论 ID 回查人工审核结果', 'ai-comment-review/list', {
        payload: { id_q: '{{cmsCommentId}}', status, page: 1, limit: 20 },
        expectedJson: [
          { path: '$.items[0].id', equalsVariable: 'commentId' },
          { path: '$.items[0].status', equals: status },
          { path: '$.items[0].review_reason', exists: true },
          { path: '$.items[0].reviewed_at', exists: true }
        ]
      })
    ]
  });
}

const overviewExpectedJson = [{ path: '$.today', exists: true }, { path: '$.rows', exists: true }];
const recordsExpectedJson = [{ path: '$', exists: true }];
const reviewListExpectedJson = [{ path: '$.items', exists: true }, { path: '$.total', exists: true }];
const statsExpectedJson = [
  { path: '$.today_approved', exists: true }, { path: '$.today_rejected', exists: true },
  { path: '$.pending_manual', exists: true }, { path: '$.week_total', exists: true }
];

const positiveDefinitions = [
  { id: 'summary-default', name: '正例：AI评论概览默认查询', action: 'ai-comment/summary', expectedJson: overviewExpectedJson },
  { id: 'summary-current-date', name: '正例：AI评论概览指定当日查询', action: 'ai-comment/summary', payload: { date: '2026-08-03' }, expectedJson: overviewExpectedJson },
  { id: 'summary-history-date', name: '正例：AI评论概览历史日期查询', action: 'ai-comment/summary', payload: { date: '2026-08-01' }, expectedJson: overviewExpectedJson },
  { id: 'summary-project', name: '正例：AI评论概览按项目查询', action: 'ai-comment/summary', payload: { project_id: 160 }, expectedJson: overviewExpectedJson },
  { id: 'summary-date-project', name: '正例：AI评论概览按日期和项目查询', action: 'ai-comment/summary', payload: { date: '2026-08-03', project_id: 160 }, expectedJson: overviewExpectedJson },
  { id: 'summary-empty-date', name: '正例：AI评论概览无数据日期查询', action: 'ai-comment/summary', payload: { date: '2026-01-01' }, expectedJson: overviewExpectedJson },
  { id: 'summary-empty-project', name: '正例：AI评论概览无数据项目查询', action: 'ai-comment/summary', payload: { project_id: 0 }, expectedJson: overviewExpectedJson },
  { id: 'configs-default', name: '正例：AI评论配置列表查询', action: 'ai-comment/configs', expectedJson: [{ path: '$', exists: true }] },
  { id: 'records-default', name: '正例：AI评论生成记录默认查询', action: 'ai-comment/records', expectedJson: recordsExpectedJson },
  { id: 'records-current-date', name: '正例：AI评论生成记录指定当日查询', action: 'ai-comment/records', payload: { date: '2026-08-03' }, expectedJson: recordsExpectedJson },
  { id: 'records-history-date', name: '正例：AI评论生成记录历史日期查询', action: 'ai-comment/records', payload: { date: '2026-08-01' }, expectedJson: recordsExpectedJson },
  { id: 'records-project', name: '正例：AI评论生成记录按项目查询', action: 'ai-comment/records', payload: { project_id: 160 }, expectedJson: recordsExpectedJson },
  { id: 'records-date-project', name: '正例：AI评论生成记录按日期和项目查询', action: 'ai-comment/records', payload: { date: '2026-08-03', project_id: 160 }, expectedJson: recordsExpectedJson },
  { id: 'records-limit-1', name: '正例：AI评论生成记录最小条数查询', action: 'ai-comment/records', payload: { limit: 1 }, expectedJson: recordsExpectedJson },
  { id: 'records-limit-20', name: '正例：AI评论生成记录二十条查询', action: 'ai-comment/records', payload: { limit: 20 }, expectedJson: recordsExpectedJson },
  { id: 'records-limit-200', name: '正例：AI评论生成记录最大条数查询', action: 'ai-comment/records', payload: { limit: 200 }, expectedJson: recordsExpectedJson },
  { id: 'review-list-default', name: '正例：AI评论审核列表默认查询', action: 'ai-comment-review/list', expectedJson: reviewListExpectedJson },
  ...['approved', 'rejected', 'manual_review', 'deleted', 'pending_review'].map((status) => ({ id: `review-list-status-${status}`, name: `正例：AI评论审核列表${status}状态筛选`, action: 'ai-comment-review/list', payload: { status, page: 1, limit: 20 }, expectedJson: reviewListExpectedJson })),
  ...['ai', 'user'].map((source) => ({ id: `review-list-source-${source}`, name: `正例：AI评论审核列表${source}来源筛选`, action: 'ai-comment-review/list', payload: { source, page: 1, limit: 20 }, expectedJson: reviewListExpectedJson })),
  { id: 'review-list-query', name: '正例：AI评论审核列表内容模糊查询', action: 'ai-comment-review/list', payload: { q: '自动化', page: 1, limit: 20 }, expectedJson: reviewListExpectedJson },
  { id: 'review-list-id-query', name: '正例：AI评论审核列表评论ID查询', action: 'ai-comment-review/list', payload: { id_q: 0, page: 1, limit: 20 }, expectedJson: reviewListExpectedJson },
  { id: 'review-list-date-range', name: '正例：AI评论审核列表日期范围查询', action: 'ai-comment-review/list', payload: { date_start: '2026-08-01', date_end: '2026-08-03', page: 1, limit: 20 }, expectedJson: reviewListExpectedJson },
  { id: 'review-list-page-2', name: '正例：AI评论审核列表第二页查询', action: 'ai-comment-review/list', payload: { page: 2, limit: 20 }, expectedJson: reviewListExpectedJson },
  { id: 'review-list-limit-1', name: '正例：AI评论审核列表最小条数查询', action: 'ai-comment-review/list', payload: { page: 1, limit: 1 }, expectedJson: reviewListExpectedJson },
  { id: 'review-list-limit-50', name: '正例：AI评论审核列表五十条查询', action: 'ai-comment-review/list', payload: { page: 1, limit: 50 }, expectedJson: reviewListExpectedJson },
  { id: 'review-list-limit-200', name: '正例：AI评论审核列表最大条数查询', action: 'ai-comment-review/list', payload: { page: 1, limit: 200 }, expectedJson: reviewListExpectedJson },
  { id: 'review-stats-default', name: '正例：AI评论审核统计默认查询', action: 'ai-comment-review/stats', expectedJson: statsExpectedJson },
  { id: 'review-stats-project', name: '正例：AI评论审核统计按项目查询', action: 'ai-comment-review/stats', payload: { project_id: 160 }, expectedJson: statsExpectedJson },
  { id: 'review-stats-empty-project', name: '正例：AI评论审核统计无数据项目查询', action: 'ai-comment-review/stats', payload: { project_id: 0 }, expectedJson: statsExpectedJson },
  { id: 'review-stats-project-1', name: '正例：AI评论审核统计项目一查询', action: 'ai-comment-review/stats', payload: { project_id: 1 }, expectedJson: statsExpectedJson },
  { id: 'review-stats-project-160-date', name: '正例：AI评论审核统计项目查询复核', action: 'ai-comment-review/stats', payload: { project_id: 160 }, expectedJson: statsExpectedJson }
];

const invalidRequestStatus = [400, 422];
const negativeDefinitions = [
  { id: 'unauth-summary', name: '反例：AI评论概览未认证拦截', action: 'ai-comment/summary', expectedStatus: 401, auth: 'none' },
  { id: 'unauth-configs', name: '反例：AI评论配置未认证拦截', action: 'ai-comment/configs', expectedStatus: 401, auth: 'none' },
  { id: 'unauth-review-list', name: '反例：AI评论审核列表未认证拦截', action: 'ai-comment-review/list', expectedStatus: 401, auth: 'none' },
  { id: 'summary-invalid-date', name: '反例：AI评论概览非法日期拦截', action: 'ai-comment/summary', payload: { date: '2026-99-99' }, expectedStatus: invalidRequestStatus },
  { id: 'records-invalid-date', name: '反例：AI评论生成记录非法日期拦截', action: 'ai-comment/records', payload: { date: 'invalid-date' }, expectedStatus: invalidRequestStatus },
  { id: 'review-invalid-date-start', name: '反例：AI评论审核列表非法起始日期拦截', action: 'ai-comment-review/list', payload: { date_start: '2026-99-01' }, expectedStatus: invalidRequestStatus },
  { id: 'review-invalid-date-end', name: '反例：AI评论审核列表非法结束日期拦截', action: 'ai-comment-review/list', payload: { date_end: 'bad-date' }, expectedStatus: invalidRequestStatus },
  { id: 'review-invalid-status', name: '反例：AI评论审核列表非法状态拦截', action: 'ai-comment-review/list', payload: { status: 'invalid_status' }, expectedStatus: invalidRequestStatus },
  { id: 'review-invalid-source', name: '反例：AI评论审核列表非法来源拦截', action: 'ai-comment-review/list', payload: { source: 'robot' }, expectedStatus: invalidRequestStatus },
  { id: 'review-page-zero', name: '反例：AI评论审核列表零页码拦截', action: 'ai-comment-review/list', payload: { page: 0 }, expectedStatus: invalidRequestStatus },
  { id: 'review-page-negative', name: '反例：AI评论审核列表负页码拦截', action: 'ai-comment-review/list', payload: { page: -1 }, expectedStatus: invalidRequestStatus },
  { id: 'review-limit-zero', name: '反例：AI评论审核列表零条数拦截', action: 'ai-comment-review/list', payload: { limit: 0 }, expectedStatus: invalidRequestStatus },
  { id: 'review-limit-overflow', name: '反例：AI评论审核列表超上限条数拦截', action: 'ai-comment-review/list', payload: { limit: 201 }, expectedStatus: invalidRequestStatus },
  { id: 'records-limit-zero', name: '反例：AI评论生成记录零条数拦截', action: 'ai-comment/records', payload: { limit: 0 }, expectedStatus: invalidRequestStatus },
  { id: 'records-limit-overflow', name: '反例：AI评论生成记录超上限条数拦截', action: 'ai-comment/records', payload: { limit: 201 }, expectedStatus: invalidRequestStatus },
  { id: 'summary-project-type', name: '反例：AI评论概览项目类型错误拦截', action: 'ai-comment/summary', payload: { project_id: 'not-a-number' }, expectedStatus: invalidRequestStatus },
  { id: 'review-project-type', name: '反例：AI评论审核列表项目类型错误拦截', action: 'ai-comment-review/list', payload: { project_id: 'not-a-number' }, expectedStatus: invalidRequestStatus },
  { id: 'stats-project-type', name: '反例：AI评论审核统计项目类型错误拦截', action: 'ai-comment-review/stats', payload: { project_id: 'not-a-number' }, expectedStatus: invalidRequestStatus },
  { id: 'review-inverted-date-range', name: '反例：AI评论审核列表反向日期范围查询', action: 'ai-comment-review/list', payload: { date_start: '2026-08-03', date_end: '2026-08-01' }, expectedJson: reviewListExpectedJson },
  { id: 'review-long-query', name: '反例：AI评论审核列表超长关键词查询', action: 'ai-comment-review/list', payload: { q: '自动化'.repeat(100), page: 1, limit: 20 }, expectedJson: reviewListExpectedJson }
];

function readonlyCase(definition, { projectId, baseUrl }) {
  return editorialCase({
    id: `ark-editorial-ai-comment-${definition.id}`,
    name: definition.name,
    projectId,
    baseUrl,
    steps: [requestStep(`ark-editorial-ai-comment-${definition.id}-request`, definition.name, definition.action, definition)]
  });
}

export function arkAiCommentReviewCases({ projectId, baseUrl }) {
  const documentedCases = [
    editorialCase({
      id: 'ark-editorial-ai-comment-overview',
      name: 'AI 评论概览查询',
      projectId,
      baseUrl,
      steps: [
        requestStep('comment-summary', '查询按项目汇总的 AI 评论数据', 'ai-comment/summary', {
          expectedJson: [{ path: '$.today', exists: true }, { path: '$.rows', exists: true }]
        }),
        requestStep('comment-configs', '查询 AI 评论项目配置列表', 'ai-comment/configs', {
          expectedJson: [{ path: '$', exists: true }]
        }),
        requestStep('comment-records', '查询 AI 评论生成记录', 'ai-comment/records', {
          payload: { limit: 20 }, expectedJson: [{ path: '$', exists: true }]
        })
      ]
    }),
    editorialCase({
      id: 'ark-editorial-ai-review-query',
      name: 'AI 评论审核列表查询',
      projectId,
      baseUrl,
      steps: [
        requestStep('review-list', '查询 AI 来源的评论审核列表', 'ai-comment-review/list', {
          payload: { source: 'ai', page: 1, limit: 20 },
          expectedJson: [{ path: '$.items', exists: true }, { path: '$.total', exists: true }]
        }),
        requestStep('review-stats', '查询评论审核统计卡数据', 'ai-comment-review/stats', {
          expectedJson: [{ path: '$.today_approved', exists: true }, { path: '$.today_rejected', exists: true }, { path: '$.pending_manual', exists: true }]
        })
      ]
    }),
    reviewCase({ id: 'ark-editorial-ai-review-approve', name: 'AI 评论人工通过闭环', action: 'approve', status: 'approved', projectId, baseUrl }),
    reviewCase({ id: 'ark-editorial-ai-review-reject', name: 'AI 评论人工驳回闭环', action: 'reject', status: 'rejected', projectId, baseUrl })
  ];
  return [...documentedCases, ...positiveDefinitions.map((definition) => readonlyCase(definition, { projectId, baseUrl })), ...negativeDefinitions.map((definition) => readonlyCase(definition, { projectId, baseUrl }))];
}

export function seedArkAiCommentReviewCases(store, { baseUrl }) {
  const project = store.listProjects().find((item) => item.name === '方舟AI评论审核');
  if (!project || !baseUrl) return 0;
  const cases = arkAiCommentReviewCases({ projectId: project.id, baseUrl });
  cases.forEach((testCase) => store.saveCase(testCase));
  return cases.length;
}
