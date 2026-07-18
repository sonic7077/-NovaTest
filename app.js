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
const selectedCaseIds = new Set();

function updateEditorBreadcrumb() {
  $('#breadcrumb').innerHTML = `测试资产 <i data-lucide="chevron-right"></i> <span>${activeProjectName || '项目'} · ${target === 'api' ? '接口用例编排' : 'Web UI 用例编排'}</span>`;
}

function renderRoute() {
  const route = location.hash || '#/dashboard';
  const projectRoute = /^#\/projects\/([^/]+)\/assets(?:\/([^/]+))?$/.exec(route);
  const view = route === '#/dashboard' ? 'dashboard' : (route === '#/assets' ? 'projects-list' : (projectRoute ? (projectRoute[2] ? 'asset-editor' : 'assets-list') : 'asset-editor'));
  document.querySelectorAll('.route-view').forEach((element) => { element.hidden = element.dataset.routeView !== view; });
  document.querySelectorAll('.nav-item[href^="#/"]').forEach((link) => link.classList.toggle('active', link.getAttribute('href') === (view === 'dashboard' ? '#/dashboard' : '#/assets')));
  if (view === 'dashboard') $('#breadcrumb').innerHTML = '工作台 <i data-lucide="chevron-right"></i> <span>执行概览</span>';
  else if (view === 'projects-list') $('#breadcrumb').innerHTML = '测试资产 <i data-lucide="chevron-right"></i> <span>项目目录</span>';
  else updateEditorBreadcrumb();
  lucide.createIcons();
  if (view === 'dashboard') loadDashboard();
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

lucide.createIcons();

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
  $('#addStep').hidden = isApi;
  apiSteps.hidden = !isApi;
  $('#addApiStep').hidden = !isApi;
  $('#apiRequestPreview').hidden = !isApi;
  $('#debugApiCase').hidden = !isApi;
  $('#editorEyebrow').textContent = isApi ? 'STRUCTURED API TEST CASE' : 'AI-POWERED WEB TEST CASE';
  $('#editorSubtitle').textContent = isApi ? '以明确的请求、断言和变量提取定义接口回归流程。' : '自然语言描述网页步骤，由 Playwright 与 Midscene 自动执行。';
  document.querySelectorAll('.target-tab[data-target]').forEach((tab) => tab.classList.toggle('selected', tab.dataset.target === target));
  updateEditorBreadcrumb();
  lucide.createIcons();
  if (isApi) updateApiRequestPreview();
}

$('#addStep').addEventListener('click', () => {
  const number = String(steps.children.length + 1).padStart(2, '0');
  const node = document.createElement('div');
  node.className = 'step';
  node.dataset.kind = 'action';
  node.innerHTML = `<span class="grab"><i data-lucide="grip-vertical"></i></span><span class="step-number">${number}</span><div class="step-content"><div class="step-type"><i data-lucide="mouse-pointer-click"></i>执行操作</div><textarea placeholder="例如：点击确认按钮，等待页面提示提交成功"></textarea></div><button class="step-menu" title="步骤菜单"><i data-lucide="more-horizontal"></i></button>`;
  steps.appendChild(node);
  node.querySelector('textarea').focus();
  lucide.createIcons();
});

$('#addApiStep').addEventListener('click', () => {
  apiSteps.appendChild(renderApiStepNode({ instruction: '', request: { method: 'POST', safety: 'readonly', payload: {}, expectedStatus: 1, expectedJson: [], extract: {} } }, apiSteps.children.length));
  lucide.createIcons();
  updateApiRequestPreview();
});

apiSteps.addEventListener('input', updateApiRequestPreview);

function updateApiRequestPreview() {
  const first = apiSteps.firstElementChild;
  if (!first) return;
  const value = (field) => first.querySelector(`[data-field="${field}"]`)?.value || '';
  try {
    $('#apiPreviewCode').textContent = JSON.stringify({ method: 'POST', action: value('action'), payload: parseJson(value('payload'), '请求 Body', {}), expectedStatus: Number(value('expectedStatus') || 1), expectedJson: parseJson(value('expectedJson'), 'JSON 断言', []), extract: parseJson(value('extract'), '变量提取', {}) }, null, 2);
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
      instruction: step.querySelector('textarea').value.trim()
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
      request: { action: node.querySelector('[data-field="action"]').value.trim(), method: 'POST', safety: node.querySelector('[data-field="safety"]').value, payload: parseJson(node.querySelector('[data-field="payload"]').value, '请求 Body', {}), expectedStatus: Number(node.querySelector('[data-field="expectedStatus"]').value || 1), expectedJson: parseJson(node.querySelector('[data-field="expectedJson"]').value, 'JSON 断言', []), extract: parseJson(node.querySelector('[data-field="extract"]').value, '变量提取', {}) }
    }))
  };
}

function renderApiStepNode(step, index) {
  const request = step.request || {};
  const node = document.createElement('article');
  node.className = 'step api-request';
  node.innerHTML = `<span class="step-number">${String(index + 1).padStart(2, '0')}</span><div class="step-content"><div class="step-type query"><i data-lucide="braces"></i>接口请求</div><label>步骤说明<input data-field="instruction"></label><div class="api-grid"><label>Action<input data-field="action" placeholder="list_post"></label><label>安全级别<select data-field="safety"><option value="readonly">只读</option><option value="mutating">写操作</option></select></label><label>预期业务状态<input data-field="expectedStatus" type="number" value="1"></label></div><label>JSON Body<textarea data-field="payload" placeholder='{"status":10}'></textarea></label><label>JSON 断言<textarea data-field="expectedJson" placeholder='[{"path":"$.total","equals":1}]'></textarea></label><label>变量提取<textarea data-field="extract" placeholder='{"postId":"$.list[0].id"}'></textarea></label></div>`;
  node.querySelector('[data-field="instruction"]').value = step.instruction || '';
  node.querySelector('[data-field="action"]').value = request.action || '';
  node.querySelector('[data-field="safety"]').value = request.safety || 'readonly';
  node.querySelector('[data-field="expectedStatus"]').value = request.expectedStatus ?? 1;
  node.querySelector('[data-field="payload"]').value = JSON.stringify(request.payload || {}, null, 2);
  node.querySelector('[data-field="expectedJson"]').value = JSON.stringify(request.expectedJson || [], null, 2);
  node.querySelector('[data-field="extract"]').value = JSON.stringify(request.extract || {}, null, 2);
  return node;
}

function renumberSteps() {
  [...steps.children].forEach((step, index) => { step.querySelector('.step-number').textContent = String(index + 1).padStart(2, '0'); });
}

function createStepNode(step, index) {
  const kindCopy = { action: ['mouse-pointer-click', '执行操作', ''], assert: ['shield-check', '智能断言', 'assert'], query: ['scan-search', '数据提取', 'query'] };
  const [icon, label, modifier] = kindCopy[step.kind] || kindCopy.action;
  const node = document.createElement('div');
  node.className = 'step';
  node.dataset.kind = step.kind;
  node.innerHTML = `<span class="grab"><i data-lucide="grip-vertical"></i></span><span class="step-number">${String(index + 1).padStart(2, '0')}</span><div class="step-content"><div class="step-type ${modifier}"><i data-lucide="${icon}"></i>${label}</div><textarea></textarea></div><button class="step-menu" title="步骤菜单"><i data-lucide="more-horizontal"></i></button>`;
  node.querySelector('textarea').value = step.instruction;
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
  lucide.createIcons();
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
  projects.forEach((project) => {
    const card = document.createElement('article');
    card.className = 'project-card';
    const copy = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = project.name;
    const meta = document.createElement('small');
    meta.textContent = `${project.caseCount} 个用例 · Web UI ${project.webCaseCount} · 接口 ${project.apiCaseCount}`;
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
  lucide.createIcons();
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
  $('#activeProjectMeta').textContent = `${project.caseCount} 个用例 · Web UI ${project.webCaseCount} · 接口 ${project.apiCaseCount}`;
  $('#newWebCaseLink').href = `${projectAssetsRoute(project.id)}/new-web`;
  $('#newApiCaseLink').href = `${projectAssetsRoute(project.id)}/new-api`;
  if (/\/assets\/[^/]+$/.test(location.hash)) updateEditorBreadcrumb();
  else $('#breadcrumb').innerHTML = `测试资产 <i data-lucide="chevron-right"></i> <span>${project.name} · 用例库</span>`;
  lucide.createIcons();
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
  lucide.createIcons();
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
    const failed = batch.runs.length - passed;
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
    summary.textContent = `${passed} 通过 · ${failed} 失败`;
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
  const response = await fetch(`/api/cases/${encodeURIComponent(testCase.id)}/runs`, { method: 'POST' });
  if (!response.ok) throw new Error((await response.json()).error || '执行测试用例失败');
  const run = await response.json();
  location.hash = '#/dashboard';
  renderRun(run);
  await loadBatchHistory(testCase.projectId);
  showToast(run.status === 'passed' ? '测试用例执行完成' : '测试用例执行失败', run.status !== 'passed');
}

async function createBatch() {
  const button = $('#runBatch');
  const caseIds = selectedCasesInOrder();
  if (!caseIds.length || button.disabled) return;
  try {
    button.disabled = true;
    button.innerHTML = '<i data-lucide="loader-circle"></i>正在执行';
    lucide.createIcons();
    const response = await fetch('/api/batches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseIds })
    });
    if (!response.ok) throw new Error((await response.json()).error || '批量执行失败');
    const batch = await response.json();
    const detail = await fetch(`/api/batches/${encodeURIComponent(batch.id)}`);
    if (!detail.ok) throw new Error('无法读取批量执行结果');
    const completedBatch = await detail.json();
    const latestRun = completedBatch.runs.at(-1);
    if (latestRun) {
      location.hash = '#/dashboard';
      renderRun(latestRun);
    }
    selectedCaseIds.clear();
    await loadSavedCases();
    await loadBatchHistory();
    showToast('批量执行完成');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.innerHTML = '<i data-lucide="list-play"></i>批量执行';
    updateBatchSelection();
    lucide.createIcons();
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

function loadDashboard() {
  loadRunnerStatus().catch((error) => showToast(error.message, true));
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
  const response = await fetch(`/api/cases/${encodeURIComponent(saved.id)}/runs`, { method: 'POST' });
  if (!response.ok) throw new Error((await response.json()).error || '接口调试失败');
  const run = await response.json();
  location.hash = '#/dashboard';
  renderRun(run);
  await loadBatchHistory();
  showToast(run.status === 'passed' ? '接口调试完成' : '接口调试失败', run.status !== 'passed');
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
renderRoute();
