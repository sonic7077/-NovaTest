import { executionFocusRoute, readExecutionFocus, resolveSelectedExecutionId } from './client/execution-navigation.js';
import { canDeleteWebStep, clipboardImageFile } from './client/web-step-interactions.js';

const $ = (selector) => document.querySelector(selector);
const steps = $('#steps');
const apiSteps = $('#apiSteps');
const log = $('#runLog');
const deviceStrip = $('#deviceStrip');
const toast = $('#toast');
let target = 'web';
let viewport = 'desktop';
let savedCases = [];
let editingCaseId = null;
let activeProjectId = null;
let activeProjectName = '';
let dashboardRange = '7d';
let executionPollId;
let currentRouteView = 'dashboard';
let selectedExecutionId = null;
let handledExecutionFocusId = '';
let currentUser = null;
const selectedCaseIds = new Set();

function renderIcons() {
  window.lucide?.createIcons();
}

function setApplicationVisible(visible) {
  document.querySelector('.sidebar').hidden = !visible;
  document.querySelector('main').hidden = !visible;
  $('#loginScreen').hidden = visible;
}

function renderCurrentUser() {
  if (!currentUser) return;
  $('#currentUserName').textContent = currentUser.displayName;
  $('#currentUserTitle').textContent = currentUser.jobTitle;
  $('#currentUserAvatar').textContent = (currentUser.displayName || currentUser.username).slice(0, 2).toUpperCase();
  $('#profileUsername').value = currentUser.username;
  $('#profileDisplayName').value = currentUser.displayName;
  $('#profileJobTitle').value = currentUser.jobTitle;
  $('#profileEmail').value = currentUser.email || '';
}

async function restoreSession() {
  const response = await fetch('/api/auth/session');
  if (!response.ok) { currentUser = null; setApplicationVisible(false); return; }
  currentUser = (await response.json()).user;
  setApplicationVisible(true);
  renderCurrentUser();
  renderRoute();
}

async function handleLogin(event) {
  event.preventDefault();
  const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: $('#loginUsername').value, password: $('#loginPassword').value }) });
  if (!response.ok) { $('#loginError').textContent = '账号或密码错误，请重新输入。'; $('#loginError').hidden = false; return; }
  currentUser = (await response.json()).user;
  $('#loginError').hidden = true;
  $('#loginPassword').value = '';
  setApplicationVisible(true);
  renderCurrentUser();
  renderRoute();
}

async function saveProfile(event) {
  event.preventDefault();
  const response = await fetch('/api/auth/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: $('#profileDisplayName').value, jobTitle: $('#profileJobTitle').value, email: $('#profileEmail').value }) });
  if (!response.ok) throw new Error((await response.json()).error || '保存失败');
  currentUser = (await response.json()).user;
  renderCurrentUser();
  showToast('个人信息已保存');
}

async function changePassword(event) {
  event.preventDefault();
  const response = await fetch('/api/auth/password', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword: $('#currentPassword').value, newPassword: $('#newPassword').value }) });
  if (!response.ok) throw new Error((await response.json()).error || '密码修改失败');
  $('#currentPassword').value = ''; $('#newPassword').value = '';
  currentUser = null; setApplicationVisible(false);
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  currentUser = null; setApplicationVisible(false);
}

function updateEditorBreadcrumb() {
  $('#breadcrumb').innerHTML = `测试资产 <i data-lucide="chevron-right"></i> <span>${activeProjectName || '项目'} · ${target === 'api' ? '接口用例编排' : 'Web UI 用例编排'}</span>`;
}

function renderRoute() {
  const route = location.hash || '#/dashboard';
  const projectRoute = /^#\/projects\/([^/]+)\/assets(?:\/([^/]+))?$/.exec(route);
  const view = route === '#/dashboard' ? 'dashboard' : (route === '#/profile' ? 'profile' : (route === '#/model-config' ? 'model-config' : (route === '#/executions' || route.startsWith('#/executions?') ? 'executions' : (route === '#/reports' ? 'reports' : (route === '#/assets' ? 'projects-list' : (projectRoute ? (projectRoute[2] ? 'asset-editor' : 'assets-list') : 'asset-editor'))))));
  currentRouteView = view;
  if (view !== 'executions') stopExecutionPolling();
  document.querySelectorAll('.route-view').forEach((element) => { element.hidden = element.dataset.routeView !== view; });
  document.querySelectorAll('.nav-item[href^="#/"]').forEach((link) => link.classList.toggle('active', link.getAttribute('href') === (view === 'dashboard' ? '#/dashboard' : view === 'executions' ? '#/executions' : view === 'reports' ? '#/reports' : view === 'model-config' ? '#/model-config' : '#/assets')));
  if (view === 'dashboard') $('#breadcrumb').innerHTML = '工作台 <i data-lucide="chevron-right"></i> <span>执行概览</span>';
  else if (view === 'projects-list') $('#breadcrumb').innerHTML = '测试资产 <i data-lucide="chevron-right"></i> <span>项目目录</span>';
  else if (view === 'executions') $('#breadcrumb').innerHTML = '执行中心 <i data-lucide="chevron-right"></i> <span>任务队列</span>';
  else if (view === 'reports') $('#breadcrumb').innerHTML = '质量报告 <i data-lucide="chevron-right"></i> <span>报告历史</span>';
  else if (view === 'model-config') $('#breadcrumb').innerHTML = 'AI 模型配置 <i data-lucide="chevron-right"></i> <span>当前配置</span>';
  else if (view === 'profile') $('#breadcrumb').innerHTML = '个人信息 <i data-lucide="chevron-right"></i> <span>账户设置</span>';
  else updateEditorBreadcrumb();
  renderIcons();
  if (view === 'dashboard') loadDashboard();
  if (view === 'executions') loadProjectFilters(readExecutionFocus(route).projectId).then(() => loadExecutions()).catch((error) => showToast(error.message, true));
  if (view === 'reports') loadProjectFilters().then(() => loadReports()).catch((error) => showToast(error.message, true));
  if (view === 'model-config') loadModelConfig().catch((error) => showToast(error.message, true));
  if (view === 'projects-list') loadProjects().catch((error) => showToast(error.message, true));
  if (projectRoute) {
    const [, encodedProjectId, action] = projectRoute;
    activeProjectId = decodeURIComponent(encodedProjectId);
    loadProjectContext().then(async () => {
      if (!action) {
        await loadSavedCases();
        await loadBatchHistory();
      } else if (action === 'new-web' || action === 'new-api') {
        await populateProjectSelect(activeProjectId);
        resetEditor(action === 'new-api' ? 'api' : 'web', activeProjectId);
      } else {
        await loadEditor(decodeURIComponent(action), activeProjectId);
      }
    }).catch((error) => showToast(error.message, true));
  } else if (route === '#/assets/new' || route === '#/assets/new-web' || route === '#/assets/new-api') {
    redirectToDefaultProject(route.endsWith('new-api') ? 'new-api' : 'new-web').catch((error) => showToast(error.message, true));
  } else if (route.startsWith('#/assets/')) {
    loadEditor(decodeURIComponent(route.slice('#/assets/'.length))).then((testCase) => {
      if (testCase?.projectId) location.hash = projectCaseRoute(testCase.projectId, testCase.id);
    }).catch((error) => showToast(error.message, true));
  }
}

function projectAssetsRoute(projectId) { return `#/projects/${encodeURIComponent(projectId)}/assets`; }
function projectCaseRoute(projectId, caseId) { return `${projectAssetsRoute(projectId)}/${encodeURIComponent(caseId)}`; }

async function redirectToDefaultProject(action = '') {
  const response = await fetch('/api/projects');
  if (!response.ok) throw new Error('无法读取测试项目');
  const [project] = await response.json();
  if (!project) throw new Error('请先创建测试项目');
  location.hash = `${projectAssetsRoute(project.id)}${action ? `/${action}` : ''}`;
}

window.addEventListener('hashchange', renderRoute);

renderIcons();

function showToast(message, isError = false) {
  toast.querySelector('span').textContent = message;
  toast.style.background = isError ? '#813d3d' : '#1c3f34';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
}

function selectViewport(nextViewport) {
  viewport = nextViewport;
  document.querySelectorAll('.viewport-button').forEach((button) => button.classList.toggle('selected', button.dataset.viewport === viewport));
  const mobile = viewport === 'mobile';
  deviceStrip.querySelector('b').textContent = mobile ? 'Chromium · Mobile H5' : 'Chromium · Desktop';
  deviceStrip.querySelector('small').textContent = mobile ? '390 × 844 · Playwright browser context' : '1440 × 900 · Playwright browser context';
}

function bindViewportButtons() {
  document.querySelectorAll('.viewport-button').forEach((button) => button.addEventListener('click', () => selectViewport(button.dataset.viewport)));
}

bindViewportButtons();

document.querySelectorAll('.target-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    if (!tab.dataset.target) return;
    target = tab.dataset.target;
    if (target === 'web') {
      deviceStrip.innerHTML = '<span class="status-dot"></span><span><b>Chromium · Desktop</b><small>1440 × 900 · Playwright browser context</small></span><div class="viewport-switch"><button class="viewport-button selected" data-viewport="desktop">Desktop</button><button class="viewport-button" data-viewport="mobile">Mobile H5</button></div>';
      selectViewport(viewport);
      bindViewportButtons();
    } else {
      deviceStrip.innerHTML = '<span class="status-dot"></span><span><b>接口测试执行</b><small>结构化 POST 请求 · 断言、变量提取</small></span>';
    }
    syncEditorTarget();
  });
});

function syncEditorTarget() {
  const isApi = target === 'api';
  steps.hidden = isApi;
  $('#addStep').closest('.add-step-wrap').hidden = isApi;
  apiSteps.hidden = !isApi;
  $('#addApiStep').hidden = !isApi;
  $('#apiRequestPreview').hidden = !isApi;
  $('#debugApiCase').hidden = !isApi;
  $('#editorEyebrow').textContent = isApi ? 'STRUCTURED API TEST CASE' : 'AI-POWERED WEB TEST CASE';
  $('#editorSubtitle').textContent = isApi ? '以明确的请求、断言和变量提取定义接口回归流程。' : '自然语言描述网页步骤，由 Playwright 与 Midscene 自动执行。';
  document.querySelectorAll('.target-tab[data-target]').forEach((tab) => tab.classList.toggle('selected', tab.dataset.target === target));
  updateEditorBreadcrumb();
  renderIcons();
  if (isApi) updateApiRequestPreview();
}

function closeStepMenus(except) {
  document.querySelectorAll('.step-menu-popover, .add-step-menu').forEach((menu) => {
    if (menu !== except) menu.hidden = true;
  });
  $('#addStep').setAttribute('aria-expanded', String(except === $('#addStepMenu')));
}

function addWebStep(kind = 'action') {
  const node = createStepNode({ kind, instruction: '' }, steps.children.length);
  steps.appendChild(node);
  node.querySelector('textarea').focus();
  renderIcons();
}

$('#addStep').addEventListener('click', () => {
  const menu = $('#addStepMenu');
  const willOpen = menu.hidden;
  closeStepMenus(menu);
  menu.hidden = !willOpen;
  $('#addStep').setAttribute('aria-expanded', String(willOpen));
});

$('#addStepMenu').addEventListener('click', (event) => {
  const option = event.target.closest('[data-add-web-step]');
  if (!option) return;
  if (option.dataset.addWebStep === 'assert') addWebStep('assert');
  else addWebStep('action');
  closeStepMenus();
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.step-menu-wrap, .add-step-wrap')) closeStepMenus();
});

$('#addApiStep').addEventListener('click', () => {
  apiSteps.appendChild(renderApiStepNode({ instruction: '', request: { method: 'POST', safety: 'readonly', payload: {}, expectedStatus: 1, expectedJson: [], extract: {} } }, apiSteps.children.length));
  renderIcons();
  updateApiRequestPreview();
});

apiSteps.addEventListener('input', updateApiRequestPreview);

function updateApiRequestPreview() {
  const first = apiSteps.firstElementChild;
  if (!first) return;
  const value = (field) => first.querySelector(`[data-field="${field}"]`)?.value || '';
  try {
    $('#apiPreviewCode').textContent = JSON.stringify({ method: 'POST', action: value('action'), payload: parseJson(value('payload'), '请求 Body', {}), expectedStatus: Number(value('expectedStatus') || 1), expectedJson: parseJson(value('expectedJson'), 'JSON 断言', []), extract: parseJson(value('extract'), '变量提取', {}), select: parseJson(value('select'), '列表选择', undefined) }, null, 2);
  } catch (error) {
    $('#apiPreviewCode').textContent = error.message;
  }
}

function readCaseFromForm() {
  if (target === 'api') return readApiCaseFromForm();
  return {
    projectId: $('#caseProjectId').value,
    name: document.querySelector('.case-meta input').value.trim(),
    target: 'web',
    baseUrl: $('#baseUrl').value.trim(),
    viewport,
    steps: [...steps.children].map((step, index) => ({
      id: `step-${index + 1}`,
      kind: step.dataset.kind || 'action',
      instruction: step.querySelector('textarea').value.trim(),
      visualChecks: [...step.querySelectorAll('[data-visual-check]')].map((card) => ({
        id: card.dataset.visualCheckId,
        assetPath: card.dataset.assetPath,
        source: card.dataset.source || 'upload',
        description: card.querySelector('[data-visual-description]').value.trim()
      }))
    }))
  };
}

function parseJson(value, label, fallback) {
  if (!value.trim()) return fallback;
  try { return JSON.parse(value); } catch { throw new Error(`${label} 必须是有效 JSON`); }
}

function readApiCaseFromForm() {
  return {
    projectId: $('#caseProjectId').value, name: document.querySelector('.case-meta input').value.trim(), target: 'api', baseUrl: $('#baseUrl').value.trim(), viewport: 'desktop',
    steps: [...apiSteps.children].map((node, index) => ({
      id: `api-step-${index + 1}`, kind: 'apiRequest', instruction: node.querySelector('[data-field="instruction"]').value.trim() || '执行接口请求',
      request: { action: node.querySelector('[data-field="action"]').value.trim(), method: 'POST', safety: node.querySelector('[data-field="safety"]').value, payload: parseJson(node.querySelector('[data-field="payload"]').value, '请求 Body', {}), expectedStatus: Number(node.querySelector('[data-field="expectedStatus"]').value || 1), expectedJson: parseJson(node.querySelector('[data-field="expectedJson"]').value, 'JSON 断言', []), extract: parseJson(node.querySelector('[data-field="extract"]').value, '变量提取', {}), select: parseJson(node.querySelector('[data-field="select"]').value, '列表选择', undefined) }
    }))
  };
}

function renderApiStepNode(step, index) {
  const request = step.request || {};
  const node = document.createElement('article');
  node.className = 'step api-request';
  node.innerHTML = `<span class="step-number">${String(index + 1).padStart(2, '0')}</span><div class="step-content"><div class="step-type query"><i data-lucide="braces"></i>接口请求</div><label>步骤说明<input data-field="instruction"></label><div class="api-grid"><label>Action<input data-field="action" placeholder="list_post"></label><label>安全级别<select data-field="safety"><option value="readonly">只读</option><option value="mutating">写操作</option></select></label><label>预期业务状态<input data-field="expectedStatus" type="number" value="1"></label></div><label>JSON Body<textarea data-field="payload" placeholder='{"status":10}'></textarea></label><label>JSON 断言<textarea data-field="expectedJson" placeholder='[{"path":"$.total","equals":1}]'></textarea></label><label>变量提取<textarea data-field="extract" placeholder='{"postId":"$.list[0].id"}'></textarea></label><label>选择列表项<textarea data-field="select" placeholder='{"listPath":"$.data.list","variable":"memberLogId","idPath":"$.id"}'></textarea></label></div>`;
  node.querySelector('[data-field="instruction"]').value = step.instruction || '';
  node.querySelector('[data-field="action"]').value = request.action || '';
  node.querySelector('[data-field="safety"]').value = request.safety || 'readonly';
  node.querySelector('[data-field="expectedStatus"]').value = request.expectedStatus ?? 1;
  node.querySelector('[data-field="payload"]').value = JSON.stringify(request.payload || {}, null, 2);
  node.querySelector('[data-field="expectedJson"]').value = JSON.stringify(request.expectedJson || [], null, 2);
  node.querySelector('[data-field="extract"]').value = JSON.stringify(request.extract || {}, null, 2);
  node.querySelector('[data-field="select"]').value = request.select ? JSON.stringify(request.select, null, 2) : '';
  return node;
}

function renumberSteps() {
  [...steps.children].forEach((step, index) => { step.querySelector('.step-number').textContent = String(index + 1).padStart(2, '0'); });
}

function visualAssetUrl(assetPath) {
  const [caseId, fileName, ...rest] = String(assetPath || '').split('/');
  if (!caseId || !fileName || rest.length) return '';
  return `/api/cases/${encodeURIComponent(caseId)}/assets/${encodeURIComponent(fileName)}`;
}

function visualCheckCopy(kind) {
  return kind === 'assert'
    ? { heading: '验证依据图片', label: '验证说明', placeholder: '描述预期的验证结果' }
    : { heading: '辅助识别图片', label: '辅助识别说明', placeholder: '描述图片中的页面元素或状态' };
}

function createVisualCheckCard(visualCheck, kind = 'action') {
  const copy = visualCheckCopy(kind);
  const card = document.createElement('article');
  card.className = 'visual-check-card';
  card.dataset.visualCheck = '';
  card.dataset.visualCheckId = visualCheck.id;
  card.dataset.assetPath = visualCheck.assetPath;
  card.dataset.source = visualCheck.source || 'upload';

  const preview = document.createElement('img');
  preview.className = 'visual-check-preview';
  preview.alt = '参考图片预览';
  preview.src = visualCheck.previewUrl || visualAssetUrl(visualCheck.assetPath);

  const detail = document.createElement('div');
  detail.className = 'visual-check-detail';
  const label = document.createElement('label');
  label.textContent = copy.label;
  const description = document.createElement('input');
  description.type = 'text';
  description.dataset.visualDescription = '';
  description.placeholder = copy.placeholder;
  description.value = visualCheck.description || '';
  label.append(description);
  detail.append(label);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'visual-check-remove icon-button';
  remove.title = '移除参考图片';
  remove.innerHTML = '<i data-lucide="trash-2"></i>';
  remove.addEventListener('click', () => card.remove());
  card.append(preview, detail, remove);
  return card;
}

function addVisualCheckToStep(stepNode, visualCheck) {
  stepNode.querySelector('.step-visual-check-list').appendChild(createVisualCheckCard(visualCheck, stepNode.dataset.kind));
  renderIcons();
}

async function uploadVisualCheck(file, stepNode) {
  if (!editingCaseId) {
    showToast('保存用例后可上传参考图片', true);
    return;
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片');
  if (file.size > 5 * 1024 * 1024) throw new Error('参考图片不能超过 5MB');
  const uploadTrigger = stepNode.querySelector('[data-visual-upload-trigger]');
  uploadTrigger.disabled = true;
  try {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`/api/cases/${encodeURIComponent(editingCaseId)}/assets`, { method: 'POST', body: formData });
    if (!response.ok) throw new Error((await response.json()).error || '参考图片上传失败');
    const uploaded = await response.json();
    addVisualCheckToStep(stepNode, { ...uploaded, description: '', previewUrl: URL.createObjectURL(file) });
  } finally {
    uploadTrigger.disabled = false;
  }
}

function bindVisualCheckControls(stepNode) {
  const input = stepNode.querySelector('[data-visual-upload]');
  const trigger = stepNode.querySelector('[data-visual-upload-trigger]');
  trigger.addEventListener('click', () => {
    if (!editingCaseId) { showToast('保存用例后可上传参考图片', true); return; }
    input.click();
  });
  input.addEventListener('change', () => {
    const [file] = input.files;
    if (!file) return;
    uploadVisualCheck(file, stepNode)
      .catch((error) => showToast(error.message, true))
      .finally(() => { input.value = ''; });
  });
  stepNode.addEventListener('paste', (event) => {
    const file = clipboardImageFile(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    uploadVisualCheck(file, stepNode)
      .catch((error) => showToast(error.message, true));
  });
}

function createStepNode(step, index) {
  const kindCopy = { action: ['mouse-pointer-click', '执行操作', ''], assert: ['shield-check', '验证结果', 'assert'], query: ['scan-search', '数据提取', 'query'] };
  const [icon, label, modifier] = kindCopy[step.kind] || kindCopy.action;
  const visualCopy = visualCheckCopy(step.kind);
  const node = document.createElement('div');
  node.className = 'step';
  node.dataset.kind = step.kind;
  node.innerHTML = `<span class="grab"><i data-lucide="grip-vertical"></i></span><span class="step-number">${String(index + 1).padStart(2, '0')}</span><div class="step-content"><div class="step-type ${modifier}"><i data-lucide="${icon}"></i>${label}</div><textarea></textarea><section class="step-visual-checks"><div class="step-visual-check-head"><span>${visualCopy.heading}</span><button type="button" class="secondary-button" data-visual-upload-trigger><i data-lucide="image-up"></i>上传图片</button><input class="visually-hidden" data-visual-upload type="file" accept="image/png,image/jpeg,image/webp"></div><div class="step-visual-check-list"></div></section></div><div class="step-menu-wrap"><button type="button" class="step-menu" data-step-menu title="步骤菜单"><i data-lucide="more-horizontal"></i></button><div class="step-menu-popover" hidden><button type="button" data-delete-step><i data-lucide="trash-2"></i>删除步骤</button></div></div>`;
  node.querySelector('textarea').value = step.instruction;
  (step.visualChecks || []).forEach((visualCheck) => addVisualCheckToStep(node, visualCheck));
  bindVisualCheckControls(node);
  const menu = node.querySelector('.step-menu-popover');
  node.querySelector('[data-step-menu]').addEventListener('click', () => {
    const willOpen = menu.hidden;
    closeStepMenus(menu);
    menu.hidden = !willOpen;
  });
  node.querySelector('[data-delete-step]').addEventListener('click', () => {
    if (!canDeleteWebStep(steps.children.length)) {
      showToast('至少保留一个步骤', true);
      return;
    }
    node.remove();
    renumberSteps();
  });
  return node;
}

function applyCase(testCase) {
  editingCaseId = testCase.id || null;
  target = testCase.target;
  viewport = testCase.viewport;
  activeProjectId = testCase.projectId || activeProjectId;
  $('#caseProjectId').value = activeProjectId;
  document.querySelector('.case-meta input').value = testCase.name;
  $('#baseUrl').value = testCase.baseUrl;
  steps.innerHTML = '';
  apiSteps.innerHTML = '';
  if (target === 'api') testCase.steps.forEach((step, index) => apiSteps.appendChild(renderApiStepNode(step, index)));
  else testCase.steps.forEach((step, index) => steps.appendChild(createStepNode(step, index)));
  $('#editorTitle').textContent = editingCaseId ? `编辑用例 · ${testCase.name}` : `新建 ${target === 'api' ? '接口' : 'Web UI'} 用例`;
  $('#deleteCase').hidden = !editingCaseId;
  if (target === 'web') selectViewport(viewport);
  else deviceStrip.innerHTML = '<span class="status-dot"></span><span><b>接口测试执行</b><small>结构化 POST 请求 · 断言、变量提取</small></span>';
  syncEditorTarget();
  renderIcons();
}

function resetEditor(nextTarget = 'web', projectId = activeProjectId) {
  applyCase({
    name: '', projectId, target: nextTarget, baseUrl: nextTarget === 'api' ? 'https://example.test/api.php' : 'https://example.test', viewport: 'desktop',
    steps: nextTarget === 'api' ? [{ id: 'api-step-1', kind: 'apiRequest', instruction: '', request: { action: '', method: 'POST', safety: 'readonly', payload: {}, expectedStatus: 1, expectedJson: [], extract: {} } }] : [{ id: 'step-1', kind: 'action', instruction: '' }]
  });
}

export async function loadEditor(id, expectedProjectId = '') {
  const response = await fetch(`/api/cases/${encodeURIComponent(id)}`);
  if (response.status === 404) {
    location.hash = '#/assets';
    showToast('该测试用例不存在或已删除', true);
    return;
  }
  if (!response.ok) throw new Error('无法读取测试用例');
  const testCase = await response.json();
  if (expectedProjectId && testCase.projectId !== expectedProjectId) {
    location.hash = projectCaseRoute(testCase.projectId, testCase.id);
    throw new Error('该用例不属于当前项目');
  }
  activeProjectId = testCase.projectId;
  await populateProjectSelect(testCase.projectId);
  applyCase(testCase);
  return testCase;
}

async function loadProjects() {
  const response = await fetch('/api/projects');
  if (!response.ok) throw new Error('无法读取测试项目');
  const projects = await response.json();
  const container = $('#projectList');
  container.innerHTML = '';
  if (!projects.length) {
    container.innerHTML = '<p class="empty-state">还没有测试项目。</p>';
    return;
  }
  const projectMeta = (project) => `${project.caseCount} 个用例 · Web UI ${project.webCaseCount} · 接口 ${project.apiCaseCount}${project.webAuth?.provider === 'lighthouse' ? ' · 公共登录：灯塔' : ''}`;
  projects.forEach((project) => {
    const card = document.createElement('article');
    card.className = 'project-card';
    const copy = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = project.name;
    const meta = document.createElement('small');
    meta.textContent = projectMeta(project);
    copy.append(name, meta);
    const actions = document.createElement('div');
    actions.className = 'project-actions';
    const open = document.createElement('a');
    open.className = 'case-open'; open.title = '进入项目'; open.href = projectAssetsRoute(project.id); open.innerHTML = '<i data-lucide="arrow-right"></i>';
    const rename = document.createElement('button');
    rename.className = 'case-open'; rename.type = 'button'; rename.title = '重命名项目'; rename.innerHTML = '<i data-lucide="pencil"></i>';
    rename.addEventListener('click', () => renameProject(project));
    const remove = document.createElement('button');
    remove.className = 'case-open'; remove.type = 'button'; remove.title = '删除空项目'; remove.innerHTML = '<i data-lucide="trash-2"></i>';
    remove.addEventListener('click', () => deleteProject(project));
    actions.append(open, rename, remove);
    card.append(copy, actions);
    container.appendChild(card);
  });
  renderIcons();
}

async function loadProjectContext() {
  const response = await fetch('/api/projects');
  if (!response.ok) throw new Error('无法读取测试项目');
  const project = (await response.json()).find((item) => item.id === activeProjectId);
  if (!project) {
    location.hash = '#/assets';
    throw new Error('测试项目不存在或已删除');
  }
  activeProjectName = project.name;
  $('#activeProjectName').textContent = project.name;
  $('#activeProjectMeta').textContent = `${project.caseCount} 个用例 · Web UI ${project.webCaseCount} · 接口 ${project.apiCaseCount}${project.webAuth?.provider === 'lighthouse' ? ' · 公共登录：灯塔' : ''}`;
  $('#newWebCaseLink').href = `${projectAssetsRoute(project.id)}/new-web`;
  $('#newApiCaseLink').href = `${projectAssetsRoute(project.id)}/new-api`;
  if (/\/assets\/[^/]+$/.test(location.hash)) updateEditorBreadcrumb();
  else $('#breadcrumb').innerHTML = `测试资产 <i data-lucide="chevron-right"></i> <span>${project.name} · 用例库</span>`;
  renderIcons();
  return project;
}

async function populateProjectSelect(selectedProjectId) {
  const response = await fetch('/api/projects');
  if (!response.ok) throw new Error('无法读取测试项目');
  const select = $('#caseProjectId');
  select.innerHTML = '';
  (await response.json()).forEach((project) => {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    select.appendChild(option);
  });
  select.value = selectedProjectId;
}

async function createProject(event) {
  event.preventDefault();
  const input = $('#projectName');
  const response = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: input.value }) });
  if (!response.ok) throw new Error((await response.json()).error || '创建测试项目失败');
  const project = await response.json();
  input.value = '';
  location.hash = projectAssetsRoute(project.id);
}

async function renameProject(project) {
  const name = window.prompt('项目名称', project.name);
  if (name === null || name.trim() === project.name) return;
  const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  if (!response.ok) throw new Error((await response.json()).error || '重命名测试项目失败');
  await loadProjects();
}

async function deleteProject(project) {
  if (!window.confirm(`删除项目“${project.name}”？仅允许删除空项目。`)) return;
  const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error((await response.json()).error || '删除测试项目失败');
  await loadProjects();
}

async function loadSavedCases() {
  const query = $('#assetSearch').value.trim();
  const response = await fetch(`/api/cases?q=${encodeURIComponent(query)}&projectId=${encodeURIComponent(activeProjectId || '')}`);
  if (!response.ok) throw new Error('无法读取已保存用例');
  savedCases = await response.json();
  const selectedTarget = $('#assetTargetFilter').value;
  if (selectedTarget !== 'all') savedCases = savedCases.filter((testCase) => testCase.target === selectedTarget);
  $('#caseCount').textContent = savedCases.length;
  const container = $('#caseList');
  if (!savedCases.length) {
    container.innerHTML = '<tr><td colspan="5" class="empty-state">未找到测试用例。</td></tr>';
    updateBatchSelection();
    return;
  }
  container.innerHTML = '';
  savedCases.forEach((testCase) => {
    const item = document.createElement('tr');
    const select = document.createElement('input');
    select.type = 'checkbox';
    select.className = 'case-select';
    select.checked = selectedCaseIds.has(testCase.id);
    select.setAttribute('aria-label', `选择用例 ${testCase.name}`);
    select.addEventListener('change', () => {
      if (select.checked) selectedCaseIds.add(testCase.id);
      else selectedCaseIds.delete(testCase.id);
      updateBatchSelection();
    });
    const selectCell = document.createElement('td');
    selectCell.appendChild(select);
    const icon = document.createElement('span');
    icon.className = 'case-item-icon';
    icon.innerHTML = `<i data-lucide="${testCase.target === 'api' ? 'braces' : 'monitor'}"></i>`;
    const copy = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = testCase.name;
    const details = document.createElement('small');
    details.textContent = `${testCase.target === 'api' ? '接口测试 · 结构化 POST' : (testCase.viewport === 'mobile' ? 'Mobile H5 · 390 × 844' : 'Desktop · 1440 × 900')} · ${testCase.steps.length} 个步骤`;
    copy.append(name, details);
    const nameCell = document.createElement('td');
    nameCell.append(icon, copy);
    const environment = document.createElement('td');
    environment.textContent = testCase.target === 'api' ? 'API 服务' : (testCase.viewport === 'mobile' ? 'Mobile H5' : 'Desktop');
    const stepCount = document.createElement('td');
    stepCount.textContent = `${testCase.steps.length} 步`;
    const actions = document.createElement('td');
    actions.className = 'case-row-actions';
    const run = document.createElement('button');
    run.className = 'case-open';
    run.type = 'button';
    run.title = '执行用例';
    run.innerHTML = '<i data-lucide="play"></i>';
    run.addEventListener('click', () => runSavedCase(testCase).catch((error) => showToast(error.message, true)));
    const edit = document.createElement('button');
    edit.className = 'case-open';
    edit.type = 'button';
    edit.title = '编辑用例';
    edit.innerHTML = '<i data-lucide="pencil"></i>';
    edit.addEventListener('click', () => { location.hash = projectCaseRoute(activeProjectId, testCase.id); });
    const remove = document.createElement('button');
    remove.className = 'case-open danger';
    remove.type = 'button';
    remove.title = '删除用例';
    remove.innerHTML = '<i data-lucide="trash-2"></i>';
    remove.addEventListener('click', () => deleteSavedCase(testCase).catch((error) => showToast(error.message, true)));
    actions.append(run, edit, remove);
    item.append(selectCell, nameCell, environment, stepCount, actions);
    container.appendChild(item);
  });
  updateBatchSelection();
  renderIcons();
}

async function loadBatchHistory(projectId = activeProjectId) {
  const response = await fetch(projectId ? `/api/batches?projectId=${encodeURIComponent(projectId)}` : '/api/batches');
  if (!response.ok) throw new Error('无法读取批量执行历史');
  const summaries = await response.json();
  const batches = await Promise.all(summaries.slice(0, 8).map(async (batch) => {
    const detail = await fetch(`/api/batches/${encodeURIComponent(batch.id)}`);
    return detail.ok ? detail.json() : { ...batch, runs: [] };
  }));
  renderBatchHistory(batches);
}

function selectedCasesInOrder() {
  return savedCases.filter((testCase) => selectedCaseIds.has(testCase.id)).map((testCase) => testCase.id);
}

function requestMutationAuthorization(testCases) {
  const mutatingCases = testCases.filter((testCase) => testCase.steps.some((step) => step.request?.safety === 'mutating'));
  if (!mutatingCases.length) return false;
  return window.confirm(`将执行 ${mutatingCases.length} 条包含业务写入的用例，可能创建或变更测试环境数据。是否继续？`);
}

function toggleVisibleCases() {
  const visibleIds = savedCases.map(({ id }) => id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedCaseIds.has(id));
  visibleIds.forEach((id) => {
    if (allSelected) selectedCaseIds.delete(id);
    else selectedCaseIds.add(id);
  });
  loadSavedCases().catch((error) => showToast(error.message, true));
}

function updateBatchSelection() {
  const count = selectedCasesInOrder().length;
  $('#selectedCaseCount').textContent = `已选择 ${count} 个用例`;
  $('#runBatch').disabled = count === 0;
  $('#deleteSelectedCases').disabled = count === 0;
  const selectAll = $('#selectAllCases');
  selectAll.disabled = savedCases.length === 0;
  selectAll.checked = savedCases.length > 0 && count === savedCases.length;
  selectAll.indeterminate = count > 0 && count < savedCases.length;
}

function formatBatchTime(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未开始';
}

function renderBatchHistory(batches) {
  const container = $('#batchHistoryList');
  container.innerHTML = '';
  if (!batches.length) {
    container.innerHTML = '<p class="empty-state">还没有批量执行记录。</p>';
    return;
  }
  batches.forEach((batch) => {
    const item = document.createElement('article');
    item.className = 'batch-item';
    const passed = batch.runs.filter((run) => run.status === 'passed').length;
    const failed = batch.runs.filter((run) => run.status === 'failed').length;
    const skipped = batch.runs.filter((run) => run.status === 'skipped').length;
    const title = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = batch.name;
    const meta = document.createElement('small');
    meta.textContent = `${batch.caseIds.length} 个用例 · ${formatBatchTime(batch.startedAt)}`;
    title.append(name, meta);
    const state = document.createElement('span');
    state.className = `batch-status ${batch.status}`;
    state.textContent = batch.status.toUpperCase();
    const summary = document.createElement('p');
    summary.textContent = `${passed} 通过 · ${skipped} 前置不足 · ${failed} 失败`;
    const reports = document.createElement('div');
    reports.className = 'batch-reports';
    const report = document.createElement('a');
    report.href = `/api/batches/${batch.id}/report`;
    report.target = '_blank';
    report.rel = 'noopener';
    report.textContent = '查看汇总报告';
    reports.appendChild(report);
    item.append(title, state, summary, reports);
    container.appendChild(item);
  });
}

async function deleteSavedCase(testCase) {
  if (!window.confirm(`删除用例“${testCase.name}”？已生成的执行记录和报告会保留。`)) return;
  const response = await fetch(`/api/cases/${encodeURIComponent(testCase.id)}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error('删除测试用例失败');
  selectedCaseIds.delete(testCase.id);
  await loadSavedCases();
  await loadBatchHistory(testCase.projectId);
  showToast('测试用例已删除');
}

async function deleteSelectedCases() {
  const caseIds = selectedCasesInOrder();
  if (!caseIds.length || !window.confirm(`删除已选择的 ${caseIds.length} 个用例？已生成的执行记录和报告会保留。`)) return;
  for (const caseId of caseIds) {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error('批量删除测试用例失败');
    selectedCaseIds.delete(caseId);
  }
  await loadSavedCases();
  await loadBatchHistory();
  showToast('已删除选择的测试用例');
}

async function runSavedCase(testCase) {
  const allowMutations = requestMutationAuthorization([testCase]);
  if (testCase.steps.some((step) => step.request?.safety === 'mutating') && !allowMutations) return;
  const response = await fetch(`/api/cases/${encodeURIComponent(testCase.id)}/runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowMutations })
  });
  if (!response.ok) throw new Error((await response.json()).error || '执行测试用例失败');
  const run = await response.json();
  location.hash = `#/executions?focus=${encodeURIComponent(run.id)}`;
  showToast('测试用例已提交执行中心');
}

async function createBatch() {
  const button = $('#runBatch');
  const caseIds = selectedCasesInOrder();
  const selectedCases = savedCases.filter((testCase) => caseIds.includes(testCase.id));
  if (!caseIds.length || button.disabled) return;
  try {
    const allowMutations = requestMutationAuthorization(selectedCases);
    if (selectedCases.some((testCase) => testCase.steps.some((step) => step.request?.safety === 'mutating')) && !allowMutations) return;
    button.disabled = true;
    button.innerHTML = '<i data-lucide="loader-circle"></i>正在执行';
    renderIcons();
    const response = await fetch('/api/batches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseIds, allowMutations })
    });
    if (!response.ok) throw new Error((await response.json()).error || '批量执行失败');
    const batch = await response.json();
    location.hash = executionFocusRoute({ projectId: activeProjectId, executionId: batch.id });
    selectedCaseIds.clear();
    await loadSavedCases();
    await loadBatchHistory();
    showToast('批量任务已提交执行中心');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.innerHTML = '<i data-lucide="list-play"></i>批量执行';
    updateBatchSelection();
    renderIcons();
  }
}

async function loadRunnerStatus() {
  const response = await fetch('/api/health');
  if (!response.ok) throw new Error('无法读取执行器状态');
  const { webRunner, cmsRunner } = await response.json();
  const badge = $('#modelStatusBadge');
  $('#modelStatusText').textContent = webRunner.ready ? 'Midscene Web runner 已就绪' : webRunner.message;
  badge.textContent = webRunner.ready ? '在线' : '未配置';
  badge.classList.toggle('offline', !webRunner.ready);
  $('#runState').dataset.cmsReady = String(cmsRunner.ready);
}

async function loadModelConfig() {
  const [configResponse, healthResponse] = await Promise.all([fetch('/api/model-config'), fetch('/api/health')]);
  if (!configResponse.ok || !healthResponse.ok) throw new Error('无法读取模型配置');
  const [config, health] = await Promise.all([configResponse.json(), healthResponse.json()]);
  $('#modelBaseUrl').value = config.baseUrl || '';
  $('#modelName').value = config.modelName || '';
  $('#modelFamily').value = config.modelFamily || '';
  $('#modelApiKey').value = '';
  $('#clearModelApiKey').checked = false;
  $('#modelApiKeyStatus').textContent = config.hasApiKey ? '已保存' : '未保存';
  $('#modelConfigSource').textContent = config.source || 'MIDSCENE';
  const ready = health.webRunner.ready;
  $('#modelConfigStatus').textContent = ready ? 'Midscene Web runner 已就绪' : health.webRunner.message;
  const badge = $('#modelConfigBadge');
  badge.textContent = ready ? '已就绪' : '不可用';
  badge.classList.toggle('offline', !ready);
  $('#modelWebHealth').textContent = ready ? '已就绪' : health.webRunner.message;
  $('#modelCmsHealth').textContent = health.cmsRunner.ready ? '已就绪' : health.cmsRunner.message;
}

async function saveModelConfig(event) {
  event.preventDefault();
  const button = $('#saveModelConfig');
  button.disabled = true;
  button.innerHTML = '<i data-lucide="loader-circle"></i>保存中';
  renderIcons();
  try {
    const response = await fetch('/api/model-config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseUrl: $('#modelBaseUrl').value, modelName: $('#modelName').value, modelFamily: $('#modelFamily').value, apiKey: $('#modelApiKey').value, clearApiKey: $('#clearModelApiKey').checked }) });
    if (!response.ok) throw new Error((await response.json()).error || '模型配置保存失败');
    await loadModelConfig();
    showToast('模型配置已保存，新任务将使用该连接');
  } finally {
    button.disabled = false;
    button.innerHTML = '<i data-lucide="save"></i>保存配置';
    renderIcons();
  }
}

const dashboardEmptyMessage = '所选时间范围内暂无已完成执行记录';

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function dashboardPercent(value, total) {
  if (!total) return '--';
  return `${((value / total) * 100).toFixed(1)}%`;
}

function dashboardElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createDashboardDonut({ label, total, segments }) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const safeTotal = nonNegativeNumber(total);
  const ariaLabel = `${label}：${safeTotal} 次完成运行`;
  svg.classList.add('dashboard-donut');
  svg.setAttribute('viewBox', '0 0 42 42');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ariaLabel);

  const track = document.createElementNS(svg.namespaceURI, 'circle');
  track.setAttribute('class', 'dashboard-donut-track');
  track.setAttribute('cx', '21');
  track.setAttribute('cy', '21');
  track.setAttribute('r', '15.9155');
  svg.append(track);

  let offset = 25;
  segments.filter((segment) => nonNegativeNumber(segment.value) > 0).forEach((segment) => {
    const value = nonNegativeNumber(segment.value);
    const percentage = safeTotal ? Math.min(100, (value / safeTotal) * 100) : 0;
    const circle = document.createElementNS(svg.namespaceURI, 'circle');
    circle.setAttribute('class', `dashboard-donut-segment ${segment.tone}`);
    circle.setAttribute('cx', '21');
    circle.setAttribute('cy', '21');
    circle.setAttribute('r', '15.9155');
    const dasharray = `${percentage} ${100 - percentage}`;
    const dashoffset = String(offset);
    circle.setAttribute('stroke-dasharray', '0 100');
    circle.setAttribute('stroke-dashoffset', dashoffset);
    window.requestAnimationFrame(() => {
      circle.setAttribute('stroke-dasharray', dasharray);
    });
    offset -= percentage;
    svg.append(circle);
  });
  return svg;
}

function createDashboardDonutWrap(donut, value, label) {
  const wrapper = dashboardElement('div', 'dashboard-donut-wrap');
  const center = dashboardElement('div', 'dashboard-donut-center');
  const number = dashboardElement('b', '', value);
  const caption = dashboardElement('small', '', label);
  center.append(number, caption);
  wrapper.append(donut, center);
  return wrapper;
}

function createDashboardLegend(entries) {
  const legend = dashboardElement('div', 'dashboard-legend');
  entries.forEach((entry) => {
    const row = dashboardElement('div', 'dashboard-legend-row');
    const label = dashboardElement('span', 'dashboard-legend-label');
    const dot = dashboardElement('i', `dashboard-legend-dot ${entry.tone}`);
    label.append(dot, document.createTextNode(entry.label));
    row.append(label, dashboardElement('strong', '', entry.value));
    legend.append(row);
  });
  return legend;
}

function setDashboardEmpty(container) {
  container.classList.add('chart-empty');
  container.textContent = dashboardEmptyMessage;
}

function renderDashboardTrend(data) {
  const container = $('#dashboardTrend');
  const completedRuns = nonNegativeNumber(data?.completedRuns);
  const passedRuns = Math.min(completedRuns, nonNegativeNumber(data?.passedRuns));
  const failedRuns = Math.min(Math.max(completedRuns - passedRuns, 0), nonNegativeNumber(data?.failedRuns));
  const daily = (Array.isArray(data?.daily) ? data.daily : []).map((item) => ({
    date: String(item?.date || ''),
    passed: nonNegativeNumber(item?.passed),
    failed: nonNegativeNumber(item?.failed)
  })).filter((item) => item.date);
  if (!completedRuns || !daily.length) { setDashboardEmpty(container); return; }

  const maxDailyTotal = Math.max(...daily.map((item) => item.passed + item.failed), 1);
  container.classList.remove('chart-empty');
  container.innerHTML = '';
  const content = dashboardElement('div', 'dashboard-chart-content dashboard-trend-chart');
  const donut = createDashboardDonut({
    label: '执行质量', total: completedRuns,
    segments: [{ tone: 'pass', value: passedRuns }, { tone: 'fail', value: failedRuns }]
  });
  const summary = dashboardElement('div', 'dashboard-trend-summary');
  summary.append(
    createDashboardDonutWrap(donut, dashboardPercent(passedRuns, completedRuns), '总体通过率'),
    createDashboardLegend([
      { tone: 'pass', label: '通过', value: `${passedRuns} 次` },
      { tone: 'fail', label: '失败', value: `${failedRuns} 次` },
      { tone: 'total', label: '完成运行', value: `${completedRuns} 次` }
    ])
  );

  const scroll = dashboardElement('div', 'dashboard-daily-scroll');
  const bars = dashboardElement('div', 'dashboard-daily-bars');
  daily.forEach((item) => {
    const bar = dashboardElement('div', 'dashboard-daily-bar');
    const stack = dashboardElement('div', 'dashboard-daily-bar-stack');
    const passed = dashboardElement('span', 'dashboard-daily-bar-fill pass');
    const failed = dashboardElement('span', 'dashboard-daily-bar-fill fail');
    passed.style.height = `${(item.passed / maxDailyTotal) * 100}%`;
    failed.style.height = `${(item.failed / maxDailyTotal) * 100}%`;
    stack.setAttribute('aria-label', `${item.date}：${item.passed} 通过，${item.failed} 失败`);
    stack.append(passed, failed);
    bar.append(stack, dashboardElement('span', '', item.date.slice(5).replace('-', '/')));
    bars.append(bar);
  });
  scroll.append(bars);
  content.append(summary, scroll);
  container.append(content);
}

function renderDashboardTargetBreakdown(data) {
  const container = $('#dashboardTargetBreakdown');
  const targets = (Array.isArray(data?.targets) ? data.targets : [])
    .filter((item) => item?.target === 'web' || item?.target === 'api')
    .map((item) => ({
      target: item.target,
      completedRuns: nonNegativeNumber(item.completedRuns),
      passedRuns: Math.min(nonNegativeNumber(item.completedRuns), nonNegativeNumber(item.passedRuns))
    })).filter((item) => item.completedRuns > 0);
  const total = targets.reduce((sum, item) => sum + item.completedRuns, 0);
  if (!total) { setDashboardEmpty(container); return; }

  const chartEntries = targets.map((item) => ({
    tone: item.target,
    label: item.target === 'web' ? 'Web UI' : '接口测试',
    value: item.completedRuns,
    passedRuns: item.passedRuns
  }));
  container.classList.remove('chart-empty');
  container.innerHTML = '';
  const content = dashboardElement('div', 'dashboard-chart-content dashboard-target-chart');
  const donut = createDashboardDonut({ label: '执行类型', total, segments: chartEntries });
  const legend = createDashboardLegend(chartEntries.map((entry) => ({
    tone: entry.tone,
    label: entry.label,
    value: `${entry.completedRuns ?? entry.value} 次 · ${dashboardPercent(entry.passedRuns, entry.value)} 通过`
  })));
  content.append(createDashboardDonutWrap(donut, `${total}`, '完成运行'), legend);
  container.append(content);
}

async function loadDashboard() {
  const response = await fetch(`/api/dashboard?range=${dashboardRange}`);
  if (!response.ok) throw new Error('无法读取质量统计');
  const data = await response.json();
  $('#dashboardCompletedRuns').textContent = data.completedRuns;
  $('#dashboardPassRate').textContent = data.completedRuns ? `${data.passRate.toFixed(1)}%` : '--';
  $('#dashboardAverageDuration').textContent = data.averageDurationMs ? `${(data.averageDurationMs / 1000).toFixed(1)}s` : '--';
  $('#dashboardCaseCount').textContent = data.automatedCaseCount;
  renderDashboardTrend(data);
  renderDashboardTargetBreakdown(data);
  renderQualityList($('#dashboardFailures'), data.recentFailures, (item) => `${item.caseName} · ${item.error || '执行失败'}`);
  renderQualityList($('#dashboardReports'), data.recentReports, (item) => `${item.name} · ${item.status.toUpperCase()}`, true);
}

export async function saveCase() {
  const id = editingCaseId;
  const response = await fetch(id ? `/api/cases/${encodeURIComponent(id)}` : '/api/cases', {
    method: id ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(readCaseFromForm())
  });
  if (!response.ok) throw new Error((await response.json()).error || '保存失败');
  const saved = await response.json();
  editingCaseId = saved.id;
  activeProjectId = saved.projectId;
  $('#editorTitle').textContent = `编辑用例 · ${saved.name}`;
  $('#deleteCase').hidden = false;
  return saved;
}

export async function deleteEditor() {
  if (!editingCaseId || !window.confirm('删除用例定义后，已生成的执行记录和报告会保留。确定删除吗？')) return;
  const button = $('#deleteCase');
  button.disabled = true;
  try {
    const response = await fetch(`/api/cases/${encodeURIComponent(editingCaseId)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error('删除测试用例失败');
    selectedCaseIds.delete(editingCaseId);
    showToast('测试用例已删除');
    location.hash = projectAssetsRoute(activeProjectId);
  } finally {
    button.disabled = false;
  }
}

async function debugApiCase() {
  if (target !== 'api') return;
  const saved = await saveCase();
  const allowMutations = requestMutationAuthorization([saved]);
  if (saved.steps.some((step) => step.request?.safety === 'mutating') && !allowMutations) return;
  const response = await fetch(`/api/cases/${encodeURIComponent(saved.id)}/runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowMutations })
  });
  if (!response.ok) throw new Error((await response.json()).error || '接口调试失败');
  const run = await response.json();
  location.hash = `#/executions?focus=${encodeURIComponent(run.id)}`;
  showToast('接口调试已提交执行中心');
}

function addLog(message, state = '') {
  const line = document.createElement('div');
  line.className = `log-line ${state}`;
  line.innerHTML = `<time>${new Date().toLocaleTimeString('zh-CN', { hour12: false })}</time><span>${message}</span>`;
  log.appendChild(line);
}

function renderRun(run) {
  const count = run.steps.length;
  const passed = run.steps.filter((step) => step.status === 'passed').length;
  const isApi = run.steps.some((step) => step.api);
  $('#runState').textContent = run.status === 'passed' ? `${isApi ? '接口' : 'Web UI'} 执行完成` : `${isApi ? '接口' : 'Web UI'} 执行失败`;
  $('#statePill').textContent = run.status.toUpperCase();
  $('#statePill').style.cssText = run.status === 'passed' ? 'background:#e8f8ef;color:#178457' : 'background:#ffebeb;color:#bd3f3f';
  $('#progressBar').style.width = '100%';
  $('#progressPct').textContent = '100%';
  $('#progressCopy').textContent = `${passed} / ${count} 步骤通过`;
  log.innerHTML = '';
  run.steps.forEach((step) => {
    addLog(step.api ? `${step.api.action} · HTTP ${step.api.httpStatus} · ${step.api.durationMs}ms` : `步骤 ${step.id} ${step.status === 'passed' ? '已通过' : `失败：${step.error}`}`, step.status === 'passed' ? 'success' : 'error');
    step.logs.forEach((entry) => addLog(entry.message, entry.level));
  });
  $('#reportPreview button').onclick = () => window.open(`/api/runs/${run.id}/report`, '_blank', 'noopener');
  $('#reportPreview .report-score strong').textContent = `${passed}/${count}`;
  $('#reportPreview .report-score b').textContent = run.status.toUpperCase();
}

function renderQualityList(container, items, label, withReport = false) {
  container.innerHTML = '';
  if (!items.length) { container.textContent = '暂无记录'; return; }
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'quality-row';
    const text = document.createElement('span');
    text.textContent = label(item);
    row.append(text);
    if (withReport && item.reportUrl) {
      const button = document.createElement('button');
      button.className = 'icon-button'; button.title = '查看报告'; button.innerHTML = '<i data-lucide="arrow-up-right"></i>';
      button.onclick = () => window.open(item.reportUrl, '_blank', 'noopener');
      row.append(button);
    }
    container.append(row);
  });
  renderIcons();
}

function getExecutionConclusion(detail) {
  const steps = detail.runs.flatMap((run) => run.steps || []);
  const firstFailure = steps.find((step) => step.status === 'failed');
  const retryCount = steps.reduce((count, step) => count + Math.max(0, (step.attempts || 0) - 1), 0);
  if (detail.task.status === 'failed') return { tone: 'failed', icon: 'circle-x', title: '执行失败', description: firstFailure?.error || '存在未通过步骤', firstFailure, retryCount };
  if (detail.task.status === 'skipped') return { tone: 'attention', icon: 'circle-pause', title: '前置数据不足', description: steps.find((step) => step.status === 'skipped')?.error || '没有可用于本次运行的业务数据', firstFailure: null, retryCount };
  if (['queued', 'running'].includes(detail.task.status)) return { tone: 'running', icon: 'loader-circle', title: detail.task.status === 'queued' ? '等待执行' : '正在执行', description: '执行进度会自动刷新', firstFailure: null, retryCount };
  if (retryCount) return { tone: 'attention', icon: 'triangle-alert', title: '执行完成，需关注', description: `共发生 ${retryCount} 次重试`, firstFailure: null, retryCount };
  return { tone: 'passed', icon: 'circle-check-big', title: '执行通过', description: '所有已执行步骤均通过', firstFailure: null, retryCount: 0 };
}

function executionReportUrl(detail) {
  if (!['passed', 'failed', 'skipped'].includes(detail.task.status)) return '';
  return detail.kind === 'batch' ? `/api/batches/${encodeURIComponent(detail.task.id)}/report` : `/api/runs/${encodeURIComponent(detail.task.id)}/report`;
}

function formatExecutionDuration(startedAt, finishedAt) {
  if (!startedAt) return '尚未开始';
  const milliseconds = new Date(finishedAt || Date.now()) - new Date(startedAt);
  return `${Math.max(0, Math.round(milliseconds / 1000))} 秒`;
}

async function loadExecutionDetail(id) {
  const response = await fetch(`/api/executions/${encodeURIComponent(id)}`);
  if (response.status === 404) { selectedExecutionId = null; return; }
  if (!response.ok) throw new Error('无法读取执行详情');
  renderExecutionDetail(await response.json());
}

function renderExecutionDetail(detail) {
  const container = $('#executionDetail');
  const conclusion = getExecutionConclusion(detail);
  const steps = detail.runs.flatMap((run) => (run.steps || []).map((step) => ({ ...step, caseName: run.caseName })));
  const completedSteps = steps.filter((step) => ['passed', 'failed', 'skipped'].includes(step.status)).length;
  const passedSteps = steps.filter((step) => step.status === 'passed').length;
  const totalCases = detail.runs.length || detail.task.caseIds?.length || 1;
  const completedCases = detail.runs.filter((run) => ['passed', 'failed', 'skipped'].includes(run.status)).length;
  const percent = steps.length ? Math.round(completedSteps / steps.length * 100) : 0;
  container.innerHTML = '';

  const summary = document.createElement('section');
  summary.className = `execution-conclusion ${conclusion.tone}`;
  const conclusionIcon = document.createElement('span'); conclusionIcon.className = 'execution-conclusion-icon'; conclusionIcon.innerHTML = `<i data-lucide="${conclusion.icon}"></i>`;
  const conclusionCopy = document.createElement('div'); const conclusionTitle = document.createElement('strong'); const conclusionDescription = document.createElement('p');
  conclusionTitle.textContent = conclusion.title; conclusionDescription.textContent = conclusion.description; conclusionCopy.append(conclusionTitle, conclusionDescription);
  const conclusionState = document.createElement('span'); conclusionState.className = 'execution-state'; conclusionState.textContent = detail.task.target === 'api' ? '接口测试' : 'Web UI';
  summary.append(conclusionIcon, conclusionCopy, conclusionState);
  const progress = document.createElement('section');
  progress.className = 'execution-progress-summary';
  progress.innerHTML = `<div class="execution-progress-ring" style="--progress:${percent}%"><b>${percent}%</b><span>步骤完成</span></div><div class="execution-stat"><b>${completedCases}/${totalCases}</b><span>完成用例</span></div><div class="execution-stat"><b>${passedSteps}/${steps.length}</b><span>通过步骤</span></div><div class="execution-stat"><b>${formatExecutionDuration(detail.task.startedAt, detail.task.finishedAt)}</b><span>执行耗时</span></div>`;
  const timeline = document.createElement('section');
  timeline.className = 'execution-timeline';
  const heading = document.createElement('h3'); heading.textContent = '执行过程'; timeline.append(heading);
  if (!steps.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = '任务等待执行，步骤将在开始后显示。'; timeline.append(empty); }
  steps.forEach((step) => {
    const item = document.createElement('article'); item.className = `timeline-step ${step.status}`;
    const icon = document.createElement('span'); icon.className = 'timeline-icon'; icon.innerHTML = `<i data-lucide="${step.status === 'passed' ? 'check' : step.status === 'failed' ? 'x' : step.status === 'skipped' ? 'circle-pause' : step.status === 'running' ? 'loader-circle' : 'clock-3'}"></i>`;
    const copy = document.createElement('div');
    const title = document.createElement('b'); title.textContent = `${step.caseName || '测试用例'} · ${step.api?.action || step.id}`;
    const meta = document.createElement('small');
    const evidence = step.api ? `HTTP ${step.api.httpStatus ?? '--'} · ${step.api.durationMs ?? '--'}ms` : (step.screenshots?.length ? `${step.screenshots.length} 张截图证据` : '无附加证据');
    meta.textContent = `${step.status.toUpperCase()} · 尝试 ${step.attempts || 0} 次 · ${evidence}`;
    copy.append(title, meta);
    if (step.error) { const error = document.createElement('p'); error.textContent = step.error; copy.append(error); }
    item.append(icon, copy); timeline.append(item);
  });
  container.append(summary, progress, timeline);
  const reportUrl = executionReportUrl(detail);
  if (reportUrl) {
    const actions = document.createElement('div'); actions.className = 'execution-detail-actions';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'run-button'; button.innerHTML = '<i data-lucide="file-text"></i>查看测试报告'; button.onclick = () => window.open(reportUrl, '_blank', 'noopener');
    actions.append(button); container.append(actions);
  }
  renderIcons();
}

async function loadExecutions() {
  const query = new URLSearchParams();
  if ($('#executionProject').value) query.set('projectId', $('#executionProject').value);
  if ($('#executionStatus').value) query.set('status', $('#executionStatus').value);
  if ($('#executionTarget').value) query.set('target', $('#executionTarget').value);
  const response = await fetch(`/api/executions?${query}`);
  if (!response.ok) throw new Error('无法读取执行任务');
  const tasks = await response.json();
  const requestedExecutionId = readExecutionFocus(location.hash).executionId;
  const selection = resolveSelectedExecutionId({
    taskIds: tasks.map((task) => task.id),
    selectedExecutionId,
    handledFocusId: handledExecutionFocusId,
    requestedExecutionId
  });
  selectedExecutionId = selection.selectedExecutionId;
  handledExecutionFocusId = selection.handledFocusId;
  const list = $('#executionList'); list.innerHTML = '';
  tasks.forEach((task) => {
    const row = document.createElement('button'); row.className = `execution-item ${task.id === selectedExecutionId ? 'selected' : ''}`; row.type = 'button';
    row.textContent = `${task.name} · ${task.status.toUpperCase()} · ${task.completedSteps}/${task.totalSteps} 步`;
    row.onclick = () => { selectedExecutionId = task.id; handledExecutionFocusId = requestedExecutionId; loadExecutions(); };
    list.append(row);
  });
  if (!tasks.length) list.textContent = '暂无执行任务';
  const task = tasks.find((item) => item.id === selectedExecutionId) || tasks[0];
  const detail = $('#executionDetail');
  if (!task) { detail.textContent = '暂无选中的执行任务'; return; }
  $('#executionDetailTitle').textContent = task.name;
  await loadExecutionDetail(task.id);
  if (['queued', 'running'].includes(task.status)) startExecutionPolling(); else if (!tasks.some((item) => ['queued', 'running'].includes(item.status))) stopExecutionPolling();
}

function startExecutionPolling() {
  if (executionPollId) return;
  executionPollId = window.setInterval(() => { if (document.hidden || currentRouteView !== 'executions') stopExecutionPolling(); else loadExecutions().catch((error) => showToast(error.message, true)); }, 1500);
}

function stopExecutionPolling() { if (executionPollId) window.clearInterval(executionPollId); executionPollId = undefined; }

async function loadProjectFilters(requestedProjectId = '') {
  const response = await fetch('/api/projects');
  if (!response.ok) throw new Error('无法读取测试项目');
  const projects = await response.json();
  ['#executionProject', '#reportProject'].forEach((selector) => {
    const select = $(selector);
    const selected = select.value;
    select.innerHTML = '<option value="">全部项目</option>';
    projects.forEach((project) => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      select.append(option);
    });
    const desiredProjectId = requestedProjectId || selected;
    select.value = projects.some((project) => project.id === desiredProjectId) ? desiredProjectId : '';
  });
}

async function loadReports() {
  const query = new URLSearchParams({ range: $('#reportRange').value });
  if ($('#reportProject').value) query.set('projectId', $('#reportProject').value);
  if ($('#reportStatus').value) query.set('status', $('#reportStatus').value);
  if ($('#reportTarget').value) query.set('target', $('#reportTarget').value);
  const response = await fetch(`/api/reports?${query}`);
  if (!response.ok) throw new Error('无法读取质量报告');
  const reports = await response.json();
  renderQualityList($('#reportList'), reports, (report) => `${report.name} · ${report.status === 'skipped' ? '前置数据不足' : report.status.toUpperCase()} · ${report.passedCases} 通过 / ${report.skippedCases || 0} 前置不足 / ${report.failedCases} 失败`, true);
}

$('#saveBtn').addEventListener('click', async () => {
  try {
    const saved = await saveCase();
    showToast(`${saved.target === 'api' ? '接口' : 'Web UI'} 用例已保存`);
    if (location.hash !== projectCaseRoute(saved.projectId, saved.id)) location.hash = projectCaseRoute(saved.projectId, saved.id);
  }
  catch (error) { showToast(error.message, true); }
});

$('#projectCreateForm').addEventListener('submit', (event) => createProject(event).catch((error) => showToast(error.message, true)));
$('#refreshCases').addEventListener('click', () => loadSavedCases().catch((error) => showToast(error.message, true)));
$('#runBatch').addEventListener('click', createBatch);
$('#selectAllCases').addEventListener('change', toggleVisibleCases);
$('#deleteSelectedCases').addEventListener('click', () => deleteSelectedCases().catch((error) => showToast(error.message, true)));
$('#debugApiCase').addEventListener('click', () => debugApiCase().catch((error) => showToast(error.message, true)));
$('#cancelEdit').addEventListener('click', () => { location.hash = activeProjectId ? projectAssetsRoute(activeProjectId) : '#/assets'; });
$('#deleteCase').addEventListener('click', () => deleteEditor().catch((error) => showToast(error.message, true)));
$('#assetSearch').addEventListener('input', () => loadSavedCases().catch((error) => showToast(error.message, true)));
$('#assetTargetFilter').addEventListener('change', () => { selectedCaseIds.clear(); loadSavedCases().catch((error) => showToast(error.message, true)); });
document.querySelectorAll('[data-dashboard-range]').forEach((button) => button.addEventListener('click', () => { dashboardRange = button.dataset.dashboardRange; document.querySelectorAll('[data-dashboard-range]').forEach((item) => item.classList.toggle('selected', item === button)); loadDashboard().catch((error) => showToast(error.message, true)); }));
$('#executionProject').addEventListener('change', () => { selectedExecutionId = null; loadExecutions().catch((error) => showToast(error.message, true)); });
$('#executionStatus').addEventListener('change', () => loadExecutions().catch((error) => showToast(error.message, true)));
$('#executionTarget').addEventListener('change', () => loadExecutions().catch((error) => showToast(error.message, true)));
$('#reportProject').addEventListener('change', () => loadReports().catch((error) => showToast(error.message, true)));
['#reportStatus', '#reportTarget', '#reportRange'].forEach((selector) => $(selector).addEventListener('change', () => loadReports().catch((error) => showToast(error.message, true))));
$('#loginForm').addEventListener('submit', (event) => handleLogin(event).catch(() => { $('#loginError').textContent = '登录失败，请稍后重试。'; $('#loginError').hidden = false; }));
$('#profileForm').addEventListener('submit', (event) => saveProfile(event).catch((error) => showToast(error.message, true)));
$('#passwordForm').addEventListener('submit', (event) => changePassword(event).catch((error) => showToast(error.message, true)));
$('#modelConfigForm').addEventListener('submit', (event) => saveModelConfig(event).catch((error) => showToast(error.message, true)));
$('#logoutButton').addEventListener('click', () => logout().catch((error) => showToast(error.message, true)));
$('#currentUserButton').addEventListener('click', () => { location.hash = '#/profile'; });
window.addEventListener('hashchange', () => { if (currentUser) renderRoute(); });
setApplicationVisible(false);
restoreSession().catch(() => setApplicationVisible(false));
