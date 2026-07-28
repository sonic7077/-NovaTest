const listAssertions = [
  { path: '$.data.list', exists: true },
  { path: '$.data.total', exists: true }
];

function requestStep(id, instruction, action, payload, options = {}) {
  return {
    id,
    kind: 'apiRequest',
    instruction,
    request: {
      action,
      method: 'POST',
      payload,
      expectedStatus: options.expectedStatus ?? 1,
      safety: options.safety || 'readonly',
      ...(options.expectedJson ? { expectedJson: options.expectedJson } : {}),
      ...(options.extract ? { extract: options.extract } : {}),
      ...(options.select ? { select: options.select } : {}),
      ...(options.auth ? { auth: options.auth } : {})
    }
  };
}

function queryCase({ id, name, projectId, baseUrl, steps }) {
  return { id, name, projectId, baseUrl, target: 'api', viewport: 'desktop', steps };
}

function listStep(id, instruction, action, payload) {
  return requestStep(id, instruction, action, payload, { expectedJson: listAssertions });
}

function createPostSteps(prefix) {
  return [requestStep(`${prefix}-create`, '创建待审核自动化帖子', 'create_update_post', {
    title: `先锋营自动化 {{runId}} ${prefix}`,
    content: '自动化接口测试创建的待审核帖子，用于验证社区审核流程。',
    topic_ids: '1',
    is_draft: 1
  }, {
    safety: 'mutating',
    expectedJson: [{ path: '$.data.id', exists: true }],
    extract: { postId: '$.data.id' }
  })];
}

function postAuditCase({ id, name, auditAction, targetStatus, rejectReason }) {
  const auditPayload = rejectReason
    ? { id: ['{{postId}}'], refuse_reason: rejectReason }
    : { id: ['{{postId}}'] };
  return queryCase({
    id,
    name,
    steps: [
      ...createPostSteps(id),
      listStep(`${id}-find`, '按返回 ID 查询待审核帖子', 'list_post', { id: '{{postId}}', status: 0, page: 1, limit: 10 }),
      requestStep(`${id}-detail-before`, '查看待审核帖子详情', 'detail_post', { id: '{{postId}}' }, {
        expectedJson: [{ path: '$.data.id', equalsVariable: 'postId' }, { path: '$.data.status', equals: 0 }]
      }),
      requestStep(`${id}-audit`, auditAction === 'pass_post' ? '通过待审核帖子' : '驳回待审核帖子', auditAction, auditPayload, { safety: 'mutating' }),
      requestStep(`${id}-detail-after`, '确认帖子审核结果', 'detail_post', { id: '{{postId}}' }, {
        expectedJson: [
          { path: '$.data.id', equalsVariable: 'postId' },
          { path: '$.data.status', equals: targetStatus },
          ...(rejectReason ? [{ path: '$.data.refuse_reason', exists: true }] : [])
        ]
      })
    ]
  });
}

function commentAuditCase({ id, name, auditAction, targetStatus, reply = false, rejectReason }) {
  const auditPayload = rejectReason
    ? { id: ['{{commentId}}'], refuse_reason: rejectReason }
    : { id: ['{{commentId}}'] };
  const steps = [
    ...createPostSteps(id),
    requestStep(`${id}-add`, '为自动化帖子添加待审核评论', 'add_post_comments', {
      id: '{{postId}}', content: `先锋营自动化评论 {{runId}}`, begin: 1, end: 1
    }, { safety: 'mutating' }),
    requestStep(`${id}-select`, '查询并选择本次待审核评论', 'list_post_comments', {
      post_id: '{{postId}}', status: 0, page: 1, limit: 10
    }, {
      expectedJson: listAssertions,
      select: { listPath: '$.data.list', variable: 'commentId', idPath: '$.id' }
    }),
    requestStep(`${id}-audit`, auditAction === 'pass_post_comments' ? '通过待审核评论' : '驳回待审核评论', auditAction, auditPayload, { safety: 'mutating' }),
    requestStep(`${id}-verify`, '确认评论审核状态', 'list_post_comments', {
      id: '{{commentId}}', post_id: '{{postId}}', status: targetStatus, page: 1, limit: 10
    }, {
      expectedJson: [
        { path: '$.data.list[0].id', equalsVariable: 'commentId' },
        { path: '$.data.list[0].post_id', equalsVariable: 'postId' },
        { path: '$.data.list[0].status', equals: targetStatus }
      ]
    })
  ];
  if (reply) steps.push(requestStep(`${id}-reply`, '回复已通过评论', 'reply_post_comments', {
    id: '{{commentId}}', content: '先锋营自动化审核回复'
  }, { safety: 'mutating' }));
  return queryCase({ id, name, steps });
}

function memberAuditCase({ id, name, auditAction, targetStatus, rejectReason }) {
  const auditPayload = rejectReason
    ? { id: ['{{memberLogId}}'], reason: rejectReason }
    : { id: ['{{memberLogId}}'] };
  return queryCase({
    id,
    name,
    steps: [
      requestStep(`${id}-select`, '查询并选择待审核用户资料记录', 'list_member_update_log', { status: 0, page: 1, limit: 10 }, {
        expectedJson: listAssertions,
        select: { listPath: '$.data.list', variable: 'memberLogId', idPath: '$.id' }
      }),
      requestStep(`${id}-audit`, auditAction === 'pass_member_update_log' ? '通过用户资料修改申请' : '驳回用户资料修改申请', auditAction, auditPayload, { safety: 'mutating' }),
      requestStep(`${id}-verify`, '确认用户资料审核状态', 'list_member_update_log', {
        id: '{{memberLogId}}', status: targetStatus, page: 1, limit: 10
      }, {
        expectedJson: [
          { path: '$.data.list[0].id', equalsVariable: 'memberLogId' },
          { path: '$.data.list[0].status', equals: targetStatus }
        ]
      })
    ]
  });
}

export function arkCommunityCases({ projectId, baseUrl }) {
  const common = { projectId, baseUrl };
  return [
    queryCase({ ...common, id: 'ark-community-post-status-filters', name: '帖子状态筛选查询', steps: [
      listStep('posts-all', '查询全部帖子', 'list_post', { status: 10, page: 1, limit: 5 }),
      listStep('posts-pending', '查询待审核帖子', 'list_post', { status: 0, page: 1, limit: 5 }),
      listStep('posts-approved', '查询已通过帖子', 'list_post', { status: 1, page: 1, limit: 5 }),
      listStep('posts-rejected', '查询未通过帖子', 'list_post', { status: 2, page: 1, limit: 5 }),
      listStep('posts-drafts', '查询草稿帖子', 'list_post', { status: 3, page: 1, limit: 5 })
    ] }),
    queryCase({ ...common, id: 'ark-community-comment-status-filters', name: '评论状态筛选查询', steps: [
      listStep('comments-pending', '查询待审核评论', 'list_post_comments', { status: 0, page: 1, limit: 5 }),
      listStep('comments-approved', '查询已通过评论', 'list_post_comments', { status: 1, page: 1, limit: 5 }),
      listStep('comments-rejected', '查询未通过评论', 'list_post_comments', { status: 2, page: 1, limit: 5 })
    ] }),
    queryCase({ ...common, id: 'ark-community-member-status-filters', name: '用户资料审核状态筛选查询', steps: [
      listStep('members-all', '查询全部用户资料修改记录', 'list_member_update_log', { status: 10, page: 1, limit: 5 }),
      listStep('members-pending', '查询待审核用户资料修改记录', 'list_member_update_log', { status: 0, page: 1, limit: 5 }),
      listStep('members-rejected', '查询未通过用户资料修改记录', 'list_member_update_log', { status: 1, page: 1, limit: 5 }),
      listStep('members-approved', '查询已通过用户资料修改记录', 'list_member_update_log', { status: 2, page: 1, limit: 5 })
    ] }),
    queryCase({ ...common, id: 'ark-community-invalid-token-probe', name: '无效登录态拦截', steps: [requestStep('invalid-token', '使用无效登录态查询帖子', 'list_post', { status: 10, page: 1, limit: 1, token: 'invalid-token' }, { expectedStatus: 0, auth: 'none' })] }),
    { ...postAuditCase({ id: 'ark-community-post-approve', name: '帖子通过审核链路', auditAction: 'pass_post', targetStatus: 1 }), ...common },
    { ...postAuditCase({ id: 'ark-community-post-reject', name: '帖子驳回审核链路', auditAction: 'reject_post', targetStatus: 2, rejectReason: '自动化审核驳回原因' }), ...common },
    { ...commentAuditCase({ id: 'ark-community-comment-approve', name: '评论通过审核链路', auditAction: 'pass_post_comments', targetStatus: 1 }), ...common },
    { ...commentAuditCase({ id: 'ark-community-comment-reject', name: '评论驳回审核链路', auditAction: 'reject_post_comments', targetStatus: 2, rejectReason: '自动化评论驳回原因' }), ...common },
    { ...commentAuditCase({ id: 'ark-community-comment-reply', name: '已通过评论回复链路', auditAction: 'pass_post_comments', targetStatus: 1, reply: true }), ...common },
    { ...memberAuditCase({ id: 'ark-community-member-approve', name: '用户资料通过审核链路', auditAction: 'pass_member_update_log', targetStatus: 2 }), ...common },
    { ...memberAuditCase({ id: 'ark-community-member-reject', name: '用户资料驳回审核链路', auditAction: 'reject_member_update_log', targetStatus: 1, rejectReason: '自动化用户资料驳回原因' }), ...common }
  ];
}

export function seedArkCommunityCases(store, { baseUrl }) {
  const project = store.listProjects().find((item) => item.name === '方舟社区发帖');
  if (!project || !baseUrl) return 0;
  const cases = arkCommunityCases({ projectId: project.id, baseUrl });
  cases.forEach((testCase) => store.saveCase(testCase));
  return cases.length;
}
