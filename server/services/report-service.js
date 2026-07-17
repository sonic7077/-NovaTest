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

function apiEvidenceMarkup(step) {
  if (!step.api) return evidenceMarkup(step.runId || '', step);
  const api = step.api;
  return `<div class="api-evidence"><strong>${escapeHtml(api.action)} · HTTP ${escapeHtml(api.httpStatus)} · 业务状态 ${escapeHtml(api.businessStatus)} · ${escapeHtml(api.durationMs)}ms</strong><details><summary>请求摘要</summary><pre>${escapeHtml(JSON.stringify(api.request, null, 2))}</pre></details><details><summary>响应摘要</summary><pre>${escapeHtml(JSON.stringify(api.response, null, 2))}</pre></details></div>`;
}

export function renderReport(run, caseName) {
  const rows = run.steps.map((step) => `<tr><td>${escapeHtml(step.id)}</td><td>${escapeHtml(step.instruction || step.api?.action || '-')}</td><td>${escapeHtml(step.status)}</td><td>${step.attempts}</td><td>${escapeHtml(step.error || '-')}<div class="evidence">${step.api ? apiEvidenceMarkup(step) : evidenceMarkup(run.id, step)}</div></td></tr>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(caseName)} | 测试报告</title><style>body{font:14px system-ui;margin:40px;color:#17221f}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #d9e3dd;padding:10px;text-align:left;vertical-align:top}th{background:#eef6f1}.passed{color:#168657}.failed{color:#c74444}.evidence{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}.evidence img{width:160px;max-height:110px;object-fit:cover;border:1px solid #d9e3dd}</style></head><body><h1>${escapeHtml(caseName)}</h1><p>运行状态：<strong class="${run.status}">${escapeHtml(run.status.toUpperCase())}</strong></p><p>开始：${escapeHtml(run.startedAt)}<br>结束：${escapeHtml(run.finishedAt || '-')}</p><h2>步骤结果</h2><table><thead><tr><th>步骤</th><th>指令</th><th>状态</th><th>尝试</th><th>证据 / 错误</th></tr></thead><tbody>${rows}</tbody></table><h2>变量</h2><pre>${escapeHtml(JSON.stringify(run.variables, null, 2))}</pre></body></html>`;
}
