function requestStep(id, instruction, action, options = {}) {
  return {
    id,
    kind: 'apiRequest',
    instruction,
    request: {
      protocol: 'daygf',
      action,
      method: options.method || 'GET',
      payload: options.payload || {},
      expectedStatus: options.expectedStatus ?? 200,
      safety: 'readonly',
      ...(options.auth ? { auth: options.auth } : {}),
      ...(options.expectedJson ? { expectedJson: options.expectedJson } : {})
    }
  };
}

function testCase(module, definition, index, projectId, baseUrl) {
  const id = `daygf-${module}-${String(index + 1).padStart(2, '0')}`;
  return {
    id,
    name: `${definition.positive ? '正例' : '反例'}：一日女友-${definition.name}`,
    projectId,
    baseUrl,
    target: 'api',
    viewport: 'desktop',
    steps: [requestStep(`${id}-request`, definition.name, definition.action, definition)]
  };
}

const ok = [{ path: '$.ok', exists: true }];
const data = [{ path: '$', exists: true }];
const businessFailure = [{ path: '$.ok', equals: false }];
const compatibleRead = [{ path: '$.ok', equals: true }];
const unauthorized = 401;
const invalid = [400, 404, 422];

const modules = {
  auth: [
    { positive: true, name: '当前用户资料查询', action: '/api/me', expectedJson: ok },
    { positive: true, name: '当前用户资料重复查询', action: '/api/me', expectedJson: ok },
    { positive: true, name: '用户资料使用 Bearer 会话查询', action: '/api/me', expectedJson: data },
    { positive: true, name: '个人数据默认查询', action: '/api/profile/data', expectedJson: data },
    { positive: true, name: '个人数据会话复用查询', action: '/api/profile/data', expectedJson: data },
    { positive: true, name: '金币余额会话查询', action: '/api/coins', expectedJson: data },
    { positive: true, name: '已登录视频列表查询', action: '/api/content/mine', payload: { status: 'all', page: 1, pageSize: 1 }, expectedJson: data },
    { name: '当前用户缺少令牌拦截', action: '/api/me', auth: 'none', expectedStatus: unauthorized },
    { name: '当前用户错误令牌拦截', action: '/api/me', auth: 'invalid', expectedStatus: unauthorized },
    { name: '个人数据缺少令牌拦截', action: '/api/profile/data', auth: 'none', expectedStatus: unauthorized },
    { name: '个人数据错误令牌拦截', action: '/api/profile/data', auth: 'invalid', expectedStatus: unauthorized },
    { name: '金币余额缺少令牌拦截', action: '/api/coins', auth: 'none', expectedStatus: unauthorized },
    { name: '我的视频缺少令牌拦截', action: '/api/content/mine', auth: 'none', expectedStatus: unauthorized },
    { name: '我的动态缺少令牌拦截', action: '/api/post/mine/list', auth: 'none', expectedStatus: unauthorized },
    { name: '我的女友资料缺少令牌拦截', action: '/api/streamer/mine/list', auth: 'none', expectedStatus: unauthorized },
    { name: '搜索历史缺少令牌拦截', action: '/api/search/history', auth: 'none', expectedStatus: unauthorized },
    { name: 'VIP订单缺少令牌拦截', action: '/api/shop/vip/orders', auth: 'none', expectedStatus: unauthorized },
    { name: '金币订单缺少令牌拦截', action: '/api/shop/coin/orders', auth: 'none', expectedStatus: unauthorized }
  ],
  profile: [
    { positive: true, name: '个人中心收藏与浏览默认查询', action: '/api/profile/data', expectedJson: data },
    { positive: true, name: '金币余额查询', action: '/api/coins', expectedJson: data },
    { positive: true, name: '收藏数据会话查询', action: '/api/profile/data', expectedJson: data },
    { positive: true, name: '浏览数据会话查询', action: '/api/profile/data', expectedJson: data },
    { positive: true, name: '个人视频默认分页查询', action: '/api/content/mine', payload: { status: 'all', page: 1, pageSize: 20 }, expectedJson: data },
    { positive: true, name: '个人动态默认分页查询', action: '/api/post/mine/list', payload: { status: 'all', page: 1, pageSize: 20 }, expectedJson: data },
    { positive: true, name: '个人女友资料默认分页查询', action: '/api/streamer/mine/list', payload: { status: 'all', page: 1, pageSize: 20 }, expectedJson: data },
    { name: '浏览记录写入缺少令牌拦截', action: '/api/profile/history', method: 'POST', auth: 'none', expectedStatus: unauthorized },
    { name: '收藏写入缺少令牌拦截', action: '/api/collect', method: 'POST', auth: 'none', expectedStatus: unauthorized },
    { name: '解锁权益缺少令牌拦截', action: '/api/unlock', method: 'POST', auth: 'none', expectedStatus: unauthorized },
    { name: '解锁权益非法目标拦截', action: '/api/unlock', method: 'POST', auth: 'none', payload: { targetType: 'invalid', targetId: -1 }, expectedStatus: unauthorized },
    { name: '资料更新缺少令牌拦截', action: '/api/profile/update', method: 'POST', auth: 'none', expectedStatus: unauthorized },
    { name: '密码修改缺少令牌拦截', action: '/api/profile/password', method: 'POST', auth: 'none', expectedStatus: unauthorized },
    { name: '收藏目标缺少参数拦截', action: '/api/collect', method: 'POST', auth: 'none', expectedStatus: unauthorized },
    { name: '历史目标缺少参数拦截', action: '/api/profile/history', method: 'POST', auth: 'none', expectedStatus: unauthorized }
  ],
  content: [
    { positive: true, name: '视频列表默认分页查询', action: '/api/content/list', auth: 'none', payload: { page: 1, pageSize: 20 }, expectedJson: data },
    { positive: true, name: '视频列表城市筛选查询', action: '/api/content/list', auth: 'none', payload: { city: '杭州', page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '视频列表分类筛选查询', action: '/api/content/list', auth: 'none', payload: { category: '生活', page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '视频列表关键词筛选查询', action: '/api/content/list', auth: 'none', payload: { q: '测试', page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '视频列表最新排序查询', action: '/api/content/list', auth: 'none', payload: { sort: 'latest', page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '视频列表第二页查询', action: '/api/content/list', auth: 'none', payload: { page: 2, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '视频评论默认分页查询', action: '/api/content/1/comments', auth: 'none', payload: { page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '视频详情会话查询', action: '/api/content/1', expectedJson: data },
    { positive: true, name: '我的视频已发布筛选查询', action: '/api/content/mine', payload: { status: 'published', page: 1, pageSize: 10 }, expectedJson: data },
    { name: '视频列表零页码兼容查询', action: '/api/content/list', auth: 'none', payload: { page: 0 }, expectedJson: compatibleRead },
    { name: '视频列表超大页码兼容查询', action: '/api/content/list', auth: 'none', payload: { page: 1, pageSize: 10001 }, expectedJson: compatibleRead },
    { name: '未知视频详情业务拒绝', action: '/api/content/999999999', auth: 'none', expectedJson: businessFailure },
    { name: '未知视频评论空结果查询', action: '/api/content/999999999/comments', auth: 'none', expectedJson: compatibleRead },
    { name: '视频评论写入缺少令牌拦截', action: '/api/content/1/comment', method: 'POST', auth: 'none', payload: { content: '自动化校验' }, expectedStatus: unauthorized },
    { name: '视频互动写入缺少令牌拦截', action: '/api/content/1/interaction', method: 'POST', auth: 'none', payload: { type: 'like' }, expectedStatus: unauthorized },
    { name: '视频发布缺少令牌拦截', action: '/api/post/publish-video', method: 'POST', auth: 'none', expectedStatus: unauthorized },
    { name: '我的视频错误令牌拦截', action: '/api/content/mine', auth: 'invalid', expectedStatus: unauthorized }
  ],
  post: [
    { positive: true, name: '动态列表默认分页查询', action: '/api/feed/list', auth: 'none', payload: { page: 1, pageSize: 20 }, expectedJson: data },
    { positive: true, name: '动态列表城市筛选查询', action: '/api/feed/list', auth: 'none', payload: { city: '杭州', page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '动态列表类型筛选查询', action: '/api/feed/list', auth: 'none', payload: { kind: '图文', page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '动态列表话题筛选查询', action: '/api/feed/list', auth: 'none', payload: { topic: '日常', page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '动态列表关键词筛选查询', action: '/api/feed/list', auth: 'none', payload: { q: '测试', page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '动态列表第二页查询', action: '/api/feed/list', auth: 'none', payload: { page: 2, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '动态详情会话查询', action: '/api/post/1', expectedJson: data },
    { positive: true, name: '动态评论默认查询', action: '/api/post/1/comments', auth: 'none', payload: { page: 1, pageSize: 10 }, expectedJson: data },
    { name: '动态列表零页码兼容查询', action: '/api/feed/list', auth: 'none', payload: { page: 0 }, expectedJson: compatibleRead },
    { name: '动态列表超大分页兼容查询', action: '/api/feed/list', auth: 'none', payload: { page: 1, pageSize: 10001 }, expectedJson: compatibleRead },
    { name: '未知动态详情业务拒绝', action: '/api/post/999999999', auth: 'none', expectedJson: businessFailure },
    { name: '未知动态评论空结果查询', action: '/api/post/999999999/comments', auth: 'none', expectedJson: compatibleRead },
    { name: '动态评论写入缺少令牌拦截', action: '/api/post/1/comment', method: 'POST', auth: 'none', payload: { content: '自动化校验' }, expectedStatus: unauthorized },
    { name: '评论点赞缺少令牌拦截', action: '/api/comments/1/like', method: 'POST', auth: 'none', expectedStatus: unauthorized },
    { name: '动态互动缺少令牌拦截', action: '/api/post/1/interaction', method: 'POST', auth: 'none', payload: { type: 'like' }, expectedStatus: unauthorized },
    { name: '动态发布缺少令牌拦截', action: '/api/post/publish', method: 'POST', auth: 'none', expectedStatus: unauthorized }
  ],
  streamer: [
    { positive: true, name: '同城女友默认列表查询', action: '/api/streamer/list', auth: 'none', payload: { page: 1, pageSize: 20 }, expectedJson: data },
    { positive: true, name: '同城女友城市筛选查询', action: '/api/streamer/list', auth: 'none', payload: { city: '杭州', page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '同城女友省份筛选查询', action: '/api/streamer/list', auth: 'none', payload: { province: '浙江', page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '同城女友关键词筛选查询', action: '/api/streamer/list', auth: 'none', payload: { q: '测试', page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '同城女友付费筛选查询', action: '/api/streamer/list', auth: 'none', payload: { paid: 'all', page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '同城女友第二页查询', action: '/api/streamer/list', auth: 'none', payload: { page: 2, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '同城女友详情会话查询', action: '/api/streamer/1', expectedJson: data },
    { positive: true, name: '我的女友资料查询', action: '/api/streamer/mine', expectedJson: data },
    { name: '同城女友零页码兼容查询', action: '/api/streamer/list', auth: 'none', payload: { page: 0 }, expectedJson: compatibleRead },
    { name: '同城女友超大分页兼容查询', action: '/api/streamer/list', auth: 'none', payload: { page: 1, pageSize: 10001 }, expectedJson: compatibleRead },
    { name: '未知女友详情业务拒绝', action: '/api/streamer/999999999', auth: 'none', expectedJson: businessFailure },
    { name: '女友收藏缺少令牌拦截', action: '/api/streamer/1/favorite', method: 'POST', auth: 'none', expectedStatus: unauthorized },
    { name: '女友分享缺少令牌拦截', action: '/api/streamer/share', method: 'POST', auth: 'none', expectedStatus: unauthorized },
    { name: '女友提交缺少令牌拦截', action: '/api/streamer/submit', method: 'POST', auth: 'none', expectedStatus: unauthorized },
    { name: '女友下架缺少令牌拦截', action: '/api/streamer/mine/unpublish', method: 'POST', auth: 'none', expectedStatus: unauthorized },
    { name: '我的女友资料错误令牌拦截', action: '/api/streamer/mine', auth: 'invalid', expectedStatus: unauthorized }
  ],
  search: [
    { positive: true, name: '全站搜索默认查询', action: '/api/search', auth: 'none', payload: { q: '杭州', page: 1, pageSize: 20 }, expectedJson: data },
    { positive: true, name: '女友搜索查询', action: '/api/search', auth: 'none', payload: { q: '杭州', type: 'streamers', page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '视频搜索查询', action: '/api/search', auth: 'none', payload: { q: '测试', type: 'contents', page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '动态搜索查询', action: '/api/search', auth: 'none', payload: { q: '测试', type: 'posts', page: 1, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '搜索第二页查询', action: '/api/search', auth: 'none', payload: { q: '测试', page: 2, pageSize: 10 }, expectedJson: data },
    { positive: true, name: '搜索历史会话查询', action: '/api/search/history', expectedJson: data },
    { positive: true, name: '地区汇总查询', action: '/api/regions/summary', auth: 'none', expectedJson: data },
    { positive: true, name: '省份列表查询', action: '/api/regions/provinces', auth: 'none', expectedJson: data },
    { positive: true, name: '女友地区列表查询', action: '/api/streamer/regions', auth: 'none', expectedJson: data },
    { name: '搜索空关键词兼容查询', action: '/api/search', auth: 'none', payload: { q: '' }, expectedJson: compatibleRead },
    { name: '搜索非法类型兼容查询', action: '/api/search', auth: 'none', payload: { q: '测试', type: 'invalid-type' }, expectedJson: compatibleRead },
    { name: '搜索零页码兼容查询', action: '/api/search', auth: 'none', payload: { q: '测试', page: 0 }, expectedJson: compatibleRead },
    { name: '搜索超大分页兼容查询', action: '/api/search', auth: 'none', payload: { q: '测试', pageSize: 10001 }, expectedJson: compatibleRead },
    { name: '搜索历史写入缺少令牌拦截', action: '/api/search/history', method: 'POST', auth: 'none', expectedStatus: unauthorized },
    { name: '搜索历史错误令牌拦截', action: '/api/search/history', auth: 'invalid', expectedStatus: unauthorized }
  ],
  shop: [
    { positive: true, name: '商城配置查询', action: '/api/shop/config', auth: 'none', expectedJson: data },
    { positive: true, name: 'VIP订单默认查询', action: '/api/shop/vip/orders', payload: { page: 1, pageSize: 20 }, expectedJson: data },
    { positive: true, name: '金币订单默认查询', action: '/api/shop/coin/orders', payload: { page: 1, pageSize: 20 }, expectedJson: data },
    { positive: true, name: '金币流水默认查询', action: '/api/shop/coin/ledger', payload: { page: 1, pageSize: 20 }, expectedJson: data },
    { positive: true, name: '金币流水收入筛选查询', action: '/api/shop/coin/ledger', payload: { direction: 'credit', page: 1, pageSize: 10 }, expectedJson: data },
    { name: 'VIP订单缺少令牌拦截', action: '/api/shop/vip/orders', auth: 'none', expectedStatus: unauthorized },
    { name: '金币流水缺少令牌拦截', action: '/api/shop/coin/ledger', auth: 'none', expectedStatus: unauthorized },
    { name: '订单状态缺少令牌拦截', action: '/api/shop/order/status/not-a-real-order', auth: 'none', expectedStatus: unauthorized }
  ],
  public: [
    { positive: true, name: '站点首页聚合查询', action: '/api/home', auth: 'none', expectedJson: data },
    { positive: true, name: '广告位列表查询', action: '/api/ads', auth: 'none', expectedJson: data },
    { positive: true, name: '埋点配置查询', action: '/api/track/config', auth: 'none', expectedJson: data },
    { positive: true, name: '公开用户作品查询', action: '/api/users/12345678/works', auth: 'none', payload: { type: 'posts', page: 1 }, expectedJson: data },
    { name: '未知公开用户业务拒绝', action: '/api/users/not-a-real-user/public', auth: 'none', expectedJson: businessFailure }
  ]
};

export function daygfCases({ projectId, baseUrl }) {
  return Object.entries(modules).flatMap(([module, definitions]) => definitions.map((definition, index) => testCase(module, definition, index, projectId, baseUrl)));
}

export function seedDaygfCases(store, { baseUrl }) {
  const project = store.listProjects().find((item) => item.name === '一日女友');
  if (!project || !baseUrl) return 0;
  const cases = daygfCases({ projectId: project.id, baseUrl });
  cases.forEach((testCase) => store.saveCase(testCase));
  return cases.length;
}
