const MEMBER_URL = 'https://by.chenmoyuan.tech/admin-login#/operation/member';

function webCase({ id, name, projectId, baseUrl, steps }) {
  return { id, name, projectId, target: 'web', baseUrl, viewport: 'desktop', steps };
}

export function byAdminWebCases({ projectId, baseUrl = MEMBER_URL }) {
  return [
    webCase({
      id: 'by-admin-web-dashboard', name: 'P0 正例：BY后台-双重验证登录与看板可用', projectId, baseUrl,
      steps: [{ id: 'verify-dashboard', kind: 'assert', instruction: '确认后台已完成账号密码和动态验证码登录，页面显示“运营看板”、左侧导航和当前登录账号；保存截图证据。' }]
    }),
    webCase({
      id: 'by-admin-web-members', name: 'P0 正例：BY后台-会员管理列表可访问', projectId, baseUrl,
      steps: [
        { id: 'open-members', kind: 'action', instruction: '在左侧导航展开“运营管理”，进入“会员管理”页面。不得新增、编辑、删除、上架或下架任何会员。' },
        { id: 'verify-members', kind: 'assert', instruction: '确认会员管理页已加载，会员列表、搜索或筛选控件可见；不得提交任何会改变数据的操作；保存截图证据。' }
      ]
    })
  ];
}

export function seedByAdminWebCases(store, { projectId, baseUrl }) {
  if (!projectId || !store.getProject(projectId)) return 0;
  const cases = byAdminWebCases({ projectId, baseUrl });
  cases.forEach((testCase) => store.saveCase(testCase));
  return cases.length;
}
