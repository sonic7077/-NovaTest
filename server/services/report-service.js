import { redactBusinessSecrets, redactTransportSecrets } from './cms-crypto.js';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function evidenceMarkup(runId, step) {
  const evidence = step.screenshots?.length ? step.screenshots : (step.screenshot ? [{ path: step.screenshot, attempt: step.attempts, phase: step.status }] : []);
  if (!evidence.length) return '-';
  return evidence.map((item) => {
    const fileName = item.path.split('/').pop();
    const url = `/api/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(fileName)}`;
    return `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${escapeHtml(item.phase)} attempt ${item.attempt}" loading="lazy"></a>`;
  }).join('');
}

function visualEvidenceMarkup(runId, visualChecks) {
  return (visualChecks || []).map((visualCheck) => {
    const [caseId, fileName, ...rest] = String(visualCheck.baselinePath || '').split('/');
    const validBaseline = caseId && fileName && rest.length === 0 && caseId !== '.' && caseId !== '..' && fileName !== '.' && fileName !== '..';
    const baselineUrl = validBaseline
      ? `/api/cases/${encodeURIComponent(caseId)}/assets/${encodeURIComponent(fileName)}?runId=${encodeURIComponent(runId)}`
      : '';
    const screenshotName = String(visualCheck.screenshot || '').split('/').pop();
    const screenshotUrl = screenshotName ? `/api/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(screenshotName)}` : '';
    const status = visualCheck.status === 'passed' ? '视觉校验通过' : '视觉校验失败';
    return `<section class="visual-check ${escapeHtml(visualCheck.status)}"><strong>${status}</strong><div class="visual-check-images">${baselineUrl ? `<figure><figcaption>参考图片</figcaption><img src="${baselineUrl}" alt="参考图片"></figure>` : ''}${screenshotUrl ? `<figure><figcaption>执行截图</figcaption><img src="${screenshotUrl}" alt="执行截图"></figure>` : ''}</div><p class="visual-check-reason">${escapeHtml(visualCheck.reason || '-')}</p></section>`;
  }).join('');
}

function apiEvidenceMarkup(step) {
  if (!step.api) return evidenceMarkup(step.runId || '', step);
  const api = step.api;
  const request = redactTransportSecrets(api.request);
  const response = redactBusinessSecrets(api.response);
  const analysis = api.analysis ? `<details><summary>推荐策略分析</summary><pre>${escapeHtml(JSON.stringify(redactBusinessSecrets(api.analysis), null, 2))}</pre></details>` : '';
  const businessStatus = api.businessStatus === undefined ? '' : ` · 业务状态 ${escapeHtml(api.businessStatus)}`;
  return `<div class="api-evidence"><strong>${escapeHtml(api.action)} · HTTP ${escapeHtml(api.httpStatus)}${businessStatus} · ${escapeHtml(api.durationMs)}ms</strong><details><summary>请求摘要</summary><pre>${escapeHtml(JSON.stringify(request, null, 2))}</pre></details><details><summary>响应内容</summary><pre>${escapeHtml(JSON.stringify(response, null, 2))}</pre></details>${analysis}</div>`;
}

const reportStyles = 'body{font:14px system-ui;margin:40px;color:#17221f}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #d9e3dd;padding:10px;text-align:left;vertical-align:top}th{background:#eef6f1}.passed{color:#168657}.failed{color:#c74444}.skipped{color:#805b13}.evidence{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}.evidence img{width:160px;max-height:110px;object-fit:cover;border:1px solid #d9e3dd}.visual-check{margin-top:10px;padding:8px;border:1px solid #d9e3dd;border-radius:4px}.visual-check-images{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}.visual-check figure{margin:0}.visual-check figcaption{margin-bottom:3px;color:#53645d;font-size:12px}.visual-check img{width:160px;max-height:110px;object-fit:cover;border:1px solid #d9e3dd}.visual-check-reason{margin:7px 0 0}.run-section{margin-top:32px;padding-top:20px;border-top:1px solid #d9e3dd;scroll-margin-top:20px}.summary{display:flex;gap:12px;flex-wrap:wrap;color:#53645d;align-items:center}.summary strong{color:inherit}.report-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.report-download{display:inline-flex;align-items:center;padding:7px 10px;border:1px solid #168657;border-radius:4px;background:#168657;color:#fff;text-decoration:none;font-weight:600}.report-download:hover{background:#0f7047}.report-download:focus-visible,.status-chip:focus-visible{outline:3px solid #5b9cff;outline-offset:2px}.status-chip{display:inline-flex;gap:5px;align-items:center;padding:5px 9px;border:1px solid currentColor;border-radius:999px;text-decoration:none;font-weight:600}.status-chip.passed{color:#168657}.status-chip.failed{color:#c74444}.status-chip.skipped{color:#805b13}.status-chip.disabled{opacity:.5;cursor:not-allowed}.report-step{scroll-margin-top:20px}@media(max-width:600px){body{margin:16px}.visual-check-images{display:block}.visual-check figure+figure{margin-top:8px}}';

function statusLabel(status) {
  return status === 'skipped' ? '前置数据不足' : String(status).toUpperCase();
}

function resultAnchor(prefix, id) {
  return `${prefix}-${encodeURIComponent(String(id))}`;
}

function statusChip(status, count, targetId) {
  const label = { passed: '通过', skipped: '跳过', failed: '失败' }[status];
  const content = `<strong>${count}</strong> ${label}`;
  return count
    ? `<a class="status-chip ${status}" href="#${escapeHtml(targetId)}">${content}</a>`
    : `<span class="status-chip ${status} disabled" aria-disabled="true">${content}</span>`;
}

function statusSummary(items, anchorPrefix) {
  return ['passed', 'skipped', 'failed'].map((status) => {
    const matches = items.filter((item) => item.status === status);
    return statusChip(status, matches.length, matches[0] ? resultAnchor(anchorPrefix, matches[0].id) : '');
  }).join('');
}

export function formatLocalTime(value) {
  if (!value) return '-';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value: item }) => [type, item]));
  return `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}:${fields.second}`;
}

function runRows(run) {
  return run.steps.map((step) => `<tr id="${escapeHtml(resultAnchor('step', step.id))}" class="report-step"><td>${escapeHtml(step.id)}</td><td>${escapeHtml(step.instruction || step.api?.action || '-')}</td><td>${escapeHtml(step.status)}</td><td>${step.attempts}</td><td>${escapeHtml(step.error || '-')}<div class="evidence">${step.api ? apiEvidenceMarkup(step) : evidenceMarkup(run.id, step)}</div>${step.api ? '' : visualEvidenceMarkup(run.id, step.visualChecks)}</td></tr>`).join('');
}

function runTable(run) {
  return `<table><thead><tr><th>步骤</th><th>指令</th><th>状态</th><th>尝试</th><th>证据 / 错误</th></tr></thead><tbody>${runRows(run)}</tbody></table>`;
}

function documentMarkup(title, content) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)} | 测试报告</title><style>${reportStyles}</style></head><body>${content}</body></html>`;
}

export function renderReport(run, caseName) {
  const variables = redactTransportSecrets(run.variables || {});
  const downloadUrl = `/api/runs/${encodeURIComponent(run.id)}/report/download`;
  return documentMarkup(caseName, `<div class="report-actions"><h1>${escapeHtml(caseName)}</h1><a class="report-download" href="${downloadUrl}">导出 HTML 报告</a></div><p>运行状态：<strong class="${run.status}">${escapeHtml(statusLabel(run.status))}</strong></p><div class="summary">${statusSummary(run.steps, 'step')}</div><p>开始：${escapeHtml(formatLocalTime(run.startedAt))}<br>结束：${escapeHtml(formatLocalTime(run.finishedAt))}</p><h2>步骤结果</h2>${runTable(run)}<h2>变量</h2><pre>${escapeHtml(JSON.stringify(variables, null, 2))}</pre>`);
}

export function renderBatchReport(batch, runs) {
  const runSections = runs.map((run) => `<section id="${escapeHtml(resultAnchor('run', run.id))}" class="run-section"><h2>${escapeHtml(run.caseName || run.caseId)}</h2><p>运行状态：<strong class="${run.status}">${escapeHtml(statusLabel(run.status))}</strong></p><p>开始：${escapeHtml(formatLocalTime(run.startedAt))}<br>结束：${escapeHtml(formatLocalTime(run.finishedAt))}</p>${runTable(run)}</section>`).join('');
  const downloadUrl = `/api/batches/${encodeURIComponent(batch.id)}/report/download`;
  return documentMarkup(batch.name, `<div class="report-actions"><h1>${escapeHtml(batch.name)}</h1><a class="report-download" href="${downloadUrl}">导出 HTML 报告</a></div><p>批量状态：<strong class="${batch.status}">${escapeHtml(statusLabel(batch.status))}</strong></p><div class="summary"><span><strong>${runs.length}</strong> 个用例</span>${statusSummary(runs, 'run')}<span>开始：${escapeHtml(formatLocalTime(batch.startedAt))}</span><span>结束：${escapeHtml(formatLocalTime(batch.finishedAt))}</span></div>${runSections}`);
}
