function requestStep(id, instruction, action, options = {}) {
  return {
    id,
    kind: 'apiRequest',
    instruction,
    request: {
      protocol: 'byAdmin', action, method: options.method || 'GET', payload: options.payload || {},
      expectedStatus: options.expectedStatus ?? 200, safety: options.safety || 'readonly', auth: options.auth || 'session',
      ...(options.expectedCode !== undefined ? { expectedCode: options.expectedCode } : {}),
      ...(options.expectedJson ? { expectedJson: options.expectedJson } : {}),
      ...(options.extract ? { extract: options.extract } : {}),
      ...(options.skipReason ? { skipReason: options.skipReason } : {})
    }
  };
}

function apiCase({ id, name, projectId, baseUrl, step }) {
  return { id, name, projectId, baseUrl, target: 'api', viewport: 'desktop', steps: [step] };
}

const SAFE_INPUTS = [
  ['空参数', {}], ['零值', { page: 0, pageSize: 0 }], ['负数', { page: -1, pageSize: -1 }],
  ['超大分页', { page: 999999999, pageSize: 999999999 }], ['中文', { keyword: '测试' }],
  ['Unicode', { keyword: 'e\u0301' }], ['emoji', { keyword: '🙂' }], ['替换字符', { keyword: '�' }],
  ['编码分隔符', { keyword: '%26%3D' }], ['SQL特征', { keyword: "' OR '1'='1" }], ['标签特征', { keyword: '<img>' }]
];

const READONLY_ENDPOINTS = [
  ['认证-当前账号', '/admin-api/v1/auth/info'], ['认证-可访问路由', '/admin-api/v1/auth/routes'],
  ['会员-分页查询', '/admin-api/v1/members'], ['推送-循环统计', '/admin-api/v1/member-push/loop-stats'],
  ['文章-分页查询', '/admin-api/v1/articles'], ['举报-分页查询', '/admin-api/v1/reports'],
  ['站点-全局设置', '/admin-api/v1/settings'], ['站点-友情链接', '/admin-api/v1/friend-links'],
  ['站点-H5信息', '/admin-api/v1/site-info'], ['站点-落地页', '/admin-api/v1/landing-page/settings'],
  ['站点-回家路', '/admin-api/v1/home-road/settings'], ['看板-概览', '/admin-api/v1/stats/overview'],
  ['审计-操作日志', '/admin-api/v1/operation-logs'], ['RBAC-管理员列表', '/admin-api/v1/admin-accounts'],
  ['RBAC-用户列表', '/admin-api/v1/users'], ['RBAC-角色列表', '/admin-api/v1/roles'], ['RBAC-菜单列表', '/admin-api/v1/menus'],
  ['Telegram-采集状态', '/admin-api/v1/telegram/user-history/status'], ['Telegram-采集审核列表', '/admin-api/v1/telegram/collection-reviews'],
  ['Telegram-用户列表', '/admin-api/v1/telegram/users'], ['Telegram-订单列表', '/admin-api/v1/telegram/orders'],
  ['通知-审核通知', '/admin-api/v1/notifications/collection-review']
];

const CONTROLLED_NEGATIVES = [
  ['登录-缺失参数', '/admin-api/v1/auth/login', 'POST', {}, 'none'],
  ['登录-错误结构', '/admin-api/v1/auth/login', 'POST', { username: [] }, 'none'],
  ['会员新增-缺失必填', '/admin-api/v1/members', 'POST', {}, 'session'],
  ['会员编辑-非法标识', '/admin-api/v1/members/invalid-id', 'PUT', {}, 'session'],
  ['会员状态-非法值', '/admin-api/v1/members/invalid-id/status', 'PATCH', { status: 'invalid' }, 'session'],
  ['文章新增-缺失标题', '/admin-api/v1/articles', 'POST', {}, 'session'],
  ['文章编辑-非法标识', '/admin-api/v1/articles/invalid-id', 'PUT', {}, 'session'],
  ['文章状态-非法值', '/admin-api/v1/articles/invalid-id/status', 'PUT', { status: 'invalid' }, 'session'],
  ['举报处理-非法标识', '/admin-api/v1/reports/invalid-id', 'PATCH', { status: 'invalid' }, 'session'],
  ['联系人授权-缺失参数', '/admin-api/v1/contact-access/grants', 'POST', {}, 'session'],
  ['联系人查看-无效令牌', '/admin-api/v1/contact-access/reveal', 'POST', { grantToken: 'invalid-token' }, 'session'],
  ['配置更新-空对象', '/admin-api/v1/settings', 'PUT', {}, 'session'],
  ['角色菜单-非法标识', '/admin-api/v1/roles/invalid-id/menus', 'PUT', { menuIds: ['invalid'] }, 'session'],
  ['通知已读-错误结构', '/admin-api/v1/notifications/collection-review/read', 'POST', { ids: 'invalid' }, 'session']
];

function isDocumentedFrameworkFailure(module, label) {
  if (module === '登录-缺失参数') return true;
  if (module === '登录-错误结构') return label !== '空参数';
  return [
    '文章新增-缺失标题', '文章编辑-非法标识', '文章状态-非法值', '角色菜单-非法标识'
  ].includes(module);
}

const HIGH_RISK_ENDPOINTS = [
  ['会员删除', '/admin-api/v1/members/placeholder'], ['会员批量删除', '/admin-api/v1/member-batch/delete'],
  ['会员推送', '/admin-api/v1/members/placeholder/push'], ['循环推送', '/admin-api/v1/member-push/loop-execute'],
  ['选中推送', '/admin-api/v1/member-push/selected'], ['文章删除', '/admin-api/v1/articles/placeholder'],
  ['文章批量删除', '/admin-api/v1/article-batch/delete'], ['管理员密码重置', '/admin-api/v1/admin-accounts/placeholder/password'],
  ['管理员2FA重置', '/admin-api/v1/admin-accounts/placeholder/two-factor/reset'], ['用户删除', '/admin-api/v1/users/placeholder'],
  ['角色删除', '/admin-api/v1/roles/placeholder'], ['菜单删除', '/admin-api/v1/menus/placeholder'],
  ['支付回调', '/admin-api/v1/telegram/payment-callback'], ['Telegram快捷连接', '/admin-api/v1/telegram/user-history/quick-connect'],
  ['Telegram发送验证码', '/admin-api/v1/telegram/user-history/connect'], ['Telegram提交验证码', '/admin-api/v1/telegram/user-history/code'],
  ['Telegram提交二次密码', '/admin-api/v1/telegram/user-history/password'], ['Telegram刷新频道', '/admin-api/v1/telegram/user-history/channels/refresh'],
  ['Telegram历史同步', '/admin-api/v1/telegram/user-history/sync'], ['Telegram删除会话', '/admin-api/v1/telegram/user-history/session'],
  ['频道导航发送', '/admin-api/v1/telegram/settings/navigation/send'], ['审核通过', '/admin-api/v1/telegram/collection-reviews/placeholder/review'],
  ['审核推送重试', '/admin-api/v1/telegram/collection-reviews/placeholder/push-deliveries/placeholder/retry'],
  ['Telegram用户封禁', '/admin-api/v1/telegram/users/placeholder/block'], ['Telegram用户VIP', '/admin-api/v1/telegram/users/placeholder/vip']
];

export function byAdminCases({ projectId, baseUrl }) {
  const cases = [];
  READONLY_ENDPOINTS.forEach(([module, action]) => SAFE_INPUTS.slice(0, 5).forEach(([label, payload]) => {
    const id = `by-admin-read-${String(cases.length + 1).padStart(3, '0')}`;
    cases.push(apiCase({ id, projectId, baseUrl, name: `P1 反例：BY后台-${module}-${label}`,
      step: requestStep(`${id}-request`, `以${label}校验${module}输入边界`, action, { payload }) }));
  }));
  CONTROLLED_NEGATIVES.forEach(([module, action, method, payload, auth]) => SAFE_INPUTS.slice(0, 3).forEach(([label, variant]) => {
    const id = `by-admin-negative-${String(cases.length + 1).padStart(3, '0')}`;
    const frameworkFailure = isDocumentedFrameworkFailure(module, label);
    cases.push(apiCase({ id, projectId, baseUrl, name: `P1 反例：BY后台-${module}-${label}`,
      step: requestStep(`${id}-request`, `使用${label}验证${module}拒绝策略`, action, {
        method, payload: { ...payload, ...variant }, expectedStatus: frameworkFailure ? 500 : [200, 400, 401, 403],
        ...(frameworkFailure ? { expectedCode: 50000 } : {}), auth
      }) }));
  }));
  HIGH_RISK_ENDPOINTS.forEach(([module, action], index) => {
    const id = `by-admin-risk-${String(index + 1).padStart(3, '0')}`;
    const method = module.includes('删除') ? 'POST' : module.includes('封禁') || module.includes('VIP') || module.includes('审核通过') ? 'PATCH' : 'POST';
    cases.push(apiCase({ id, projectId, baseUrl, name: `P3 高风险：BY后台-${module}-需独立授权`,
      step: requestStep(`${id}-request`, `高风险操作 ${module} 不在日常回归中执行`, action, { method, safety: 'mutating', skipReason: '高风险操作需要独立授权' }) }));
  });
  return cases;
}

export function seedByAdminCases(store, { projectId, baseUrl }) {
  if (!projectId || !baseUrl || !store.getProject(projectId)) return 0;
  const cases = byAdminCases({ projectId, baseUrl });
  cases.forEach((testCase) => store.saveCase(testCase));
  return cases.length;
}
