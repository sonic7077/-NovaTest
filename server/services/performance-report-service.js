import { formatLocalTime } from './report-service.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function statusLabel(status) {
  return { queued: '等待执行', running: '执行中', stopping: '正在停止', stopped: '已停止', passed: '通过', failed: '失败' }[status] || status;
}

function chart(samples) {
  if (!samples.length) return '<p class="empty">暂无实时指标</p>';
  const maxP95 = Math.max(1, ...samples.map((sample) => Number(sample.p95Ms) || 0));
  const points = samples.map((sample, index) => {
    const x = samples.length === 1 ? 20 : 20 + (index * 560) / (samples.length - 1);
    const y = 140 - ((Number(sample.p95Ms) || 0) / maxP95) * 110;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="trend" viewBox="0 0 600 160" role="img" aria-label="P95 响应时间趋势"><line x1="20" y1="140" x2="580" y2="140"/><line x1="20" y1="30" x2="20" y2="140"/><polyline points="${points}"/><text x="24" y="22">P95 最大 ${escapeHtml(maxP95)} ms</text></svg>`;
}

function summaryRows(summary) {
  return [
    ['请求数', summary.requests], ['失败率', typeof summary.failures === 'number' && summary.requests ? `${((summary.failures / summary.requests) * 100).toFixed(2)}%` : '-'],
    ['P95', Number.isFinite(summary.p95Ms) ? `${summary.p95Ms} ms` : '-'], ['登录成功率', Number.isFinite(summary.loginSuccessRate) ? `${(summary.loginSuccessRate * 100).toFixed(2)}%` : '-'],
    ['读取成功率', Number.isFinite(summary.readSuccessRate) ? `${(summary.readSuccessRate * 100).toFixed(2)}%` : '-'], ['写入成功率', Number.isFinite(summary.writeSuccessRate) ? `${(summary.writeSuccessRate * 100).toFixed(2)}%` : '-']
  ].map(([name, value]) => `<div class="metric"><span>${escapeHtml(name)}</span><strong>${escapeHtml(value ?? '-')}</strong></div>`).join('');
}

const styles = `body{font:14px system-ui,-apple-system,sans-serif;margin:40px;color:#17221f;background:#fff}.header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.status{font-weight:700}.passed{color:#168657}.failed{color:#c74444}.stopped{color:#805b13}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:20px 0}.metric,section{border:1px solid #d9e3dd;border-radius:6px;padding:12px}.metric span{display:block;color:#53645d;font-size:12px}.metric strong{display:block;margin-top:4px;font-size:18px}table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #d9e3dd;padding:9px;text-align:left}th{background:#eef6f1}.passed{color:#168657}.failed{color:#c74444}.trend{width:100%;max-width:600px;display:block;margin:12px 0}.trend line{stroke:#b7cbbf}.trend polyline{fill:none;stroke:#168657;stroke-width:3}.trend text{font-size:12px;fill:#53645d}.empty{color:#53645d}@media(max-width:600px){body{margin:16px}.header{display:block}}`;

export function renderPerformanceReport(run, asset = { name: '已删除性能资产' }) {
  const summary = run.summary || {};
  const samples = Array.isArray(run.samples) ? run.samples : [];
  const verdicts = Array.isArray(summary.verdicts) ? summary.verdicts : [];
  const sampleRows = samples.length
    ? samples.map((sample) => `<tr><td>${escapeHtml(sample.phase || '-')}</td><td>${escapeHtml(sample.elapsedSeconds ?? '-')}</td><td>${escapeHtml(sample.activeVus ?? '-')}</td><td>${escapeHtml(sample.requests ?? '-')}</td><td>${escapeHtml(sample.failures ?? '-')}</td><td>${escapeHtml(sample.p95Ms ?? '-')} ms</td></tr>`).join('')
    : '<tr><td colspan="6">暂无实时指标</td></tr>';
  const verdictRows = verdicts.length
    ? verdicts.map((verdict) => `<tr class="${verdict.passed ? 'passed' : 'failed'}"><td>${escapeHtml(verdict.name)}</td><td>${escapeHtml(verdict.actual ?? '-')}</td><td>${escapeHtml(verdict.expected ?? '-')}</td><td>${verdict.passed ? '通过' : '失败'}</td></tr>`).join('')
    : '<tr><td colspan="4">暂无阈值结论</td></tr>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(asset.name)} | 性能测试报告</title><style>${styles}</style></head><body><header class="header"><div><h1>${escapeHtml(asset.name)}</h1><p>运行名称：${escapeHtml(run.name)}<br>开始：${escapeHtml(formatLocalTime(run.startedAt))}<br>结束：${escapeHtml(formatLocalTime(run.finishedAt))}</p></div><p class="status ${escapeHtml(run.status)}">${escapeHtml(statusLabel(run.status))}</p></header>${run.error ? `<section><strong>停止或失败原因</strong><p>${escapeHtml(run.error)}</p></section>` : ''}<section><h2>关键指标</h2><div class="metrics">${summaryRows(summary)}</div></section><section><h2>响应时间趋势</h2>${chart(samples)}</section><section><h2>阈值结论</h2><table><thead><tr><th>指标</th><th>实际</th><th>阈值</th><th>结论</th></tr></thead><tbody>${verdictRows}</tbody></table></section><section><h2>阶段采样</h2><table><thead><tr><th>阶段</th><th>已执行秒数</th><th>活动 VU</th><th>请求数</th><th>失败数</th><th>P95</th></tr></thead><tbody>${sampleRows}</tbody></table></section></body></html>`;
}
