function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function renderReport(run, testCase) {
  const rows = run.steps.map((step) => `<tr><td>${escapeHtml(step.id)}</td><td>${escapeHtml(step.status)}</td><td>${step.attempts}</td><td>${escapeHtml(step.error || step.screenshot || '-')}</td></tr>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(testCase.name)} | 测试报告</title><style>body{font:14px system-ui;margin:40px;color:#17221f}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #d9e3dd;padding:10px;text-align:left}th{background:#eef6f1}.passed{color:#168657}.failed{color:#c74444}</style></head><body><h1>${escapeHtml(testCase.name)}</h1><p>运行状态：<strong class="${run.status}">${escapeHtml(run.status.toUpperCase())}</strong></p><p>开始：${escapeHtml(run.startedAt)}<br>结束：${escapeHtml(run.finishedAt || '-')}</p><h2>步骤结果</h2><table><thead><tr><th>步骤</th><th>状态</th><th>尝试</th><th>证据 / 错误</th></tr></thead><tbody>${rows}</tbody></table><h2>变量</h2><pre>${escapeHtml(JSON.stringify(run.variables, null, 2))}</pre></body></html>`;
}
