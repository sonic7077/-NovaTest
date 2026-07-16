const $ = (selector) => document.querySelector(selector);
const steps = $('#steps');
const runButton = $('#runBtn');
const log = $('#runLog');
const deviceStrip = $('#deviceStrip');
const toast = $('#toast');
let target = 'web';
let viewport = 'desktop';
let savedCases = [];
const selectedCaseIds = new Set();

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
    target = tab.dataset.target;
    document.querySelector('.target-tab.selected').classList.remove('selected');
    tab.classList.add('selected');
    if (target === 'web') {
      deviceStrip.innerHTML = '<span class="status-dot"></span><span><b>Chromium · Desktop</b><small>1440 × 900 · Playwright browser context</small></span><div class="viewport-switch"><button class="viewport-button selected" data-viewport="desktop">Desktop</button><button class="viewport-button" data-viewport="mobile">Mobile H5</button></div>';
      selectViewport(viewport);
      bindViewportButtons();
    } else {
      deviceStrip.innerHTML = '<span class="status-dot"></span><span><b>API 服务暂未启用</b><small>当前 MVP 优先支持 Web UI 自动化执行</small></span>';
    }
  });
});

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

function readCaseFromForm() {
  if (target !== 'web') throw new Error('当前 MVP 仅支持 Web UI 执行');
  return {
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
  target = testCase.target;
  viewport = testCase.viewport;
  document.querySelector('.case-meta input').value = testCase.name;
  $('#baseUrl').value = testCase.baseUrl;
  steps.innerHTML = '';
  testCase.steps.forEach((step, index) => steps.appendChild(createStepNode(step, index)));
  selectViewport(viewport);
  lucide.createIcons();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadSavedCases() {
  const response = await fetch('/api/cases');
  if (!response.ok) throw new Error('无法读取已保存用例');
  savedCases = await response.json();
  $('#caseCount').textContent = savedCases.length;
  const container = $('#caseList');
  if (!savedCases.length) {
    container.innerHTML = '<p class="empty-state">还没有保存的用例。完成步骤编辑后点击“保存草稿”。</p>';
    updateBatchSelection();
    return;
  }
  container.innerHTML = '';
  savedCases.forEach((testCase) => {
    const item = document.createElement('article');
    item.className = 'case-item';
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
    const icon = document.createElement('span');
    icon.className = 'case-item-icon';
    icon.innerHTML = '<i data-lucide="monitor"></i>';
    const copy = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = testCase.name;
    const details = document.createElement('small');
    details.textContent = `${testCase.viewport === 'mobile' ? 'Mobile H5 · 390 × 844' : 'Desktop · 1440 × 900'} · ${testCase.steps.length} 个步骤`;
    copy.append(name, details);
    const edit = document.createElement('button');
    edit.className = 'case-open';
    edit.type = 'button';
    edit.title = '打开用例';
    edit.innerHTML = '<i data-lucide="chevron-right"></i>';
    edit.addEventListener('click', () => applyCase(testCase));
    item.append(select, icon, copy, edit);
    container.appendChild(item);
  });
  updateBatchSelection();
  lucide.createIcons();
}

function selectedCasesInOrder() {
  return savedCases.filter((testCase) => selectedCaseIds.has(testCase.id)).map((testCase) => testCase.id);
}

function updateBatchSelection() {
  const count = selectedCasesInOrder().length;
  $('#selectedCaseCount').textContent = `已选择 ${count} 个用例`;
  $('#runBatch').disabled = count === 0;
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
    batch.runs.forEach((run) => {
      const report = document.createElement('a');
      report.href = `/api/runs/${run.id}/report`;
      report.target = '_blank';
      report.rel = 'noopener';
      report.textContent = `${run.caseId.slice(0, 8)} ${run.status === 'passed' ? '通过' : '失败'}报告`;
      reports.appendChild(report);
    });
    item.append(title, state, summary, reports);
    container.appendChild(item);
  });
}

async function loadBatches() {
  const response = await fetch('/api/batches');
  if (!response.ok) throw new Error('无法读取批次历史');
  const batches = await response.json();
  const details = await Promise.all(batches.map(async (batch) => {
    const detailResponse = await fetch(`/api/batches/${batch.id}`);
    if (!detailResponse.ok) throw new Error('无法读取批次详情');
    return detailResponse.json();
  }));
  renderBatchHistory(details);
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
    selectedCaseIds.clear();
    await loadSavedCases();
    await loadBatches();
    showToast('批量执行已完成');
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
  const { webRunner } = await response.json();
  const badge = $('#modelStatusBadge');
  $('#modelStatusText').textContent = webRunner.ready ? 'Midscene Web runner 已就绪' : webRunner.message;
  badge.textContent = webRunner.ready ? '在线' : '未配置';
  badge.classList.toggle('offline', !webRunner.ready);
}

export async function saveCase() {
  const response = await fetch('/api/cases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(readCaseFromForm()) });
  if (!response.ok) throw new Error((await response.json()).error || '保存失败');
  return response.json();
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
  $('#runState').textContent = run.status === 'passed' ? 'Web UI 执行完成' : 'Web UI 执行失败';
  $('#statePill').textContent = run.status.toUpperCase();
  $('#statePill').style.cssText = run.status === 'passed' ? 'background:#e8f8ef;color:#178457' : 'background:#ffebeb;color:#bd3f3f';
  $('#progressBar').style.width = '100%';
  $('#progressPct').textContent = '100%';
  $('#progressCopy').textContent = `${passed} / ${count} 步骤通过`;
  log.innerHTML = '';
  run.steps.forEach((step) => {
    addLog(`步骤 ${step.id} ${step.status === 'passed' ? '已通过' : `失败：${step.error}`}`, step.status === 'passed' ? 'success' : 'error');
    step.logs.forEach((entry) => addLog(entry.message, entry.level));
  });
  $('#reportPreview button').onclick = () => window.open(`/api/runs/${run.id}/report`, '_blank', 'noopener');
  $('#reportPreview .report-score strong').textContent = `${passed}/${count}`;
  $('#reportPreview .report-score b').textContent = run.status.toUpperCase();
}

$('#saveBtn').addEventListener('click', async () => {
  try { await saveCase(); await loadSavedCases(); showToast('Web UI 用例已保存'); }
  catch (error) { showToast(error.message, true); }
});

$('#refreshCases').addEventListener('click', () => loadSavedCases().catch((error) => showToast(error.message, true)));
$('#runBatch').addEventListener('click', createBatch);
loadSavedCases().catch((error) => showToast(error.message, true));
loadBatches().catch((error) => showToast(error.message, true));
loadRunnerStatus().catch((error) => showToast(error.message, true));

runButton.addEventListener('click', async () => {
  if (runButton.disabled) return;
  try {
    runButton.disabled = true;
    runButton.innerHTML = '<i data-lucide="loader-circle"></i>创建任务';
    $('#runState').textContent = '正在创建 Web UI 执行任务';
    $('#statePill').textContent = 'RUNNING';
    $('#progressBar').style.width = '10%';
    log.innerHTML = '';
    const testCase = await saveCase();
    const response = await fetch(`/api/cases/${testCase.id}/runs`, { method: 'POST' });
    if (!response.ok) throw new Error('执行任务创建失败');
    renderRun(await response.json());
  } catch (error) {
    $('#runState').textContent = '执行任务创建失败';
    addLog(error.message, 'error');
    showToast(error.message, true);
  } finally {
    runButton.disabled = false;
    runButton.innerHTML = '<i data-lucide="play"></i>再次运行';
    lucide.createIcons();
  }
});
