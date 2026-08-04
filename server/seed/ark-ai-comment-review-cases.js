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
      expectedStatus: options.expectedStatus || 200,
      safety: options.safety || 'readonly',
      ...(options.expectedJson ? { expectedJson: options.expectedJson } : {}),
      ...(options.extract ? { extract: options.extract } : {}),
      ...(options.select ? { select: options.select } : {})
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

export function arkAiCommentReviewCases({ projectId, baseUrl }) {
  return [
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
}

export function seedArkAiCommentReviewCases(store, { baseUrl }) {
  const project = store.listProjects().find((item) => item.name === '方舟AI评论审核');
  if (!project || !baseUrl) return 0;
  const cases = arkAiCommentReviewCases({ projectId: project.id, baseUrl });
  cases.forEach((testCase) => store.saveCase(testCase));
  return cases.length;
}
