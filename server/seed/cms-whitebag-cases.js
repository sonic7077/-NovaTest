const login = { id: 'login', kind: 'apiRequest', instruction: '管理员登录并获取 token', request: { action: 'loginByPassword', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } };
const config = { id: 'config', kind: 'apiRequest', instruction: '读取社区发布配置', request: { action: 'config', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } };

export function cmsWhitebagCases({ baseUrl }) {
  return [
    { id: 'cms-whitebag-posts', name: '白包社区帖子只读冒烟', target: 'api', baseUrl, viewport: 'desktop', steps: [login, config, { id: 'posts', kind: 'apiRequest', instruction: '查询全部社区帖子', request: { action: 'list_post', method: 'POST', payload: { status: 10 }, expectedStatus: 1, safety: 'readonly' } }] },
    { id: 'cms-whitebag-comments', name: '白包社区评论只读冒烟', target: 'api', baseUrl, viewport: 'desktop', steps: [login, config, { id: 'comments', kind: 'apiRequest', instruction: '查询待审核评论', request: { action: 'list_post_comments', method: 'POST', payload: { status: 0 }, expectedStatus: 1, safety: 'readonly' } }] },
    { id: 'cms-whitebag-members', name: '白包用户审核只读冒烟', target: 'api', baseUrl, viewport: 'desktop', steps: [login, config, { id: 'members', kind: 'apiRequest', instruction: '查询用户信息修改审核记录', request: { action: 'list_member_update_log', method: 'POST', payload: { status: 10 }, expectedStatus: 1, safety: 'readonly' } }] }
  ];
}
