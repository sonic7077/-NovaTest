const listAssertions = [
  { path: '$.data.list', exists: true },
  { path: '$.data.total', exists: true }
];

function apiStep(id, instruction, action, payload) {
  return {
    id,
    kind: 'apiRequest',
    instruction,
    request: {
      action,
      method: 'POST',
      payload,
      expectedStatus: 1,
      safety: 'readonly',
      expectedJson: listAssertions
    }
  };
}

function queryCase({ id, name, projectId, baseUrl, steps }) {
  return { id, name, projectId, baseUrl, target: 'api', viewport: 'desktop', steps };
}

export function arkCommunityCases({ projectId, baseUrl }) {
  return [
    queryCase({
      id: 'ark-community-post-status-filters',
      name: '帖子状态筛选查询',
      projectId,
      baseUrl,
      steps: [
        apiStep('posts-all', '查询全部帖子', 'list_post', { status: 10, page: 1, limit: 5 }),
        apiStep('posts-pending', '查询待审核帖子', 'list_post', { status: 0, page: 1, limit: 5 }),
        apiStep('posts-approved', '查询已通过帖子', 'list_post', { status: 1, page: 1, limit: 5 }),
        apiStep('posts-rejected', '查询未通过帖子', 'list_post', { status: 2, page: 1, limit: 5 }),
        apiStep('posts-drafts', '查询草稿帖子', 'list_post', { status: 3, page: 1, limit: 5 })
      ]
    }),
    queryCase({
      id: 'ark-community-comment-status-filters',
      name: '评论状态筛选查询',
      projectId,
      baseUrl,
      steps: [
        apiStep('comments-pending', '查询待审核评论', 'list_post_comments', { status: 0, page: 1, limit: 5 }),
        apiStep('comments-approved', '查询已通过评论', 'list_post_comments', { status: 1, page: 1, limit: 5 }),
        apiStep('comments-rejected', '查询未通过评论', 'list_post_comments', { status: 2, page: 1, limit: 5 })
      ]
    }),
    queryCase({
      id: 'ark-community-member-status-filters',
      name: '用户资料审核状态筛选查询',
      projectId,
      baseUrl,
      steps: [
        apiStep('members-all', '查询全部用户资料修改记录', 'list_member_update_log', { status: 10, page: 1, limit: 5 }),
        apiStep('members-pending', '查询待审核用户资料修改记录', 'list_member_update_log', { status: 0, page: 1, limit: 5 }),
        apiStep('members-rejected', '查询未通过用户资料修改记录', 'list_member_update_log', { status: 1, page: 1, limit: 5 }),
        apiStep('members-approved', '查询已通过用户资料修改记录', 'list_member_update_log', { status: 2, page: 1, limit: 5 })
      ]
    }),
    queryCase({
      id: 'ark-community-invalid-token-probe',
      name: '无效登录态拦截',
      projectId,
      baseUrl,
      steps: [{
        id: 'invalid-token',
        kind: 'apiRequest',
        instruction: '使用无效登录态查询帖子',
        request: {
          action: 'list_post',
          method: 'POST',
          payload: { status: 10, page: 1, limit: 1, token: 'invalid-token' },
          expectedStatus: 0,
          safety: 'readonly',
          auth: 'none'
        }
      }]
    })
  ];
}

export function seedArkCommunityCases(store, { baseUrl }) {
  const project = store.listProjects().find((item) => item.name === '方舟社区发帖');
  if (!project || !baseUrl) return 0;
  const cases = arkCommunityCases({ projectId: project.id, baseUrl });
  cases.forEach((testCase) => store.saveCase(testCase));
  return cases.length;
}
