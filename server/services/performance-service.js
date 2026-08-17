function precondition(message) {
  const error = new Error(message);
  error.code = 'PRECONDITION';
  return error;
}

function maximumVus(stages) {
  return Math.max(...stages.map((stage) => stage.vus));
}

export function evaluateThresholds(summary, thresholds) {
  const values = [
    ['登录成功率', summary.loginSuccessRate, thresholds.loginSuccessRate, (actual, expected) => actual >= expected],
    ['读取成功率', summary.readSuccessRate, thresholds.readSuccessRate, (actual, expected) => actual >= expected],
    ['写入成功率', summary.writeSuccessRate, thresholds.writeSuccessRate, (actual, expected) => actual >= expected],
    ['读取 P95', summary.p95Ms, thresholds.readP95Ms, (actual, expected) => actual <= expected],
    ['服务端 5xx 比率', summary.serverErrorRate, thresholds.serverErrorRate, (actual, expected) => actual < expected]
  ];
  return values.map(([name, actual, expected, matches]) => ({
    name, actual: Number.isFinite(actual) ? actual : null, expected, passed: Number.isFinite(actual) && matches(actual, expected)
  }));
}

export class PerformanceService {
  constructor({ store, runner, schedule = setImmediate }) {
    this.store = store;
    this.runner = runner;
    this.schedule = schedule;
  }

  queue(assetId) {
    const asset = this.store.getPerformanceAsset(assetId);
    if (!asset) throw new Error('performance asset not found');
    const pool = this.store.getPerformanceAccountPool(asset.config.accountPoolId);
    const accounts = this.store.getPerformanceAccountPoolCredentials(asset.config.accountPoolId);
    if (!pool || !accounts || pool.projectId !== asset.projectId) throw precondition('账号池不可用或不属于当前项目');
    if (accounts.length < maximumVus(asset.config.stages)) throw precondition('账号池数量不足，无法满足最大并发 VU');

    const run = this.store.savePerformanceRun({
      id: crypto.randomUUID(), assetId: asset.id, projectId: asset.projectId,
      name: asset.name, status: 'queued', summary: {}, createdAt: new Date().toISOString()
    });
    this.schedule(() => { void this.execute(run.id); });
    return run;
  }

  async execute(runId) {
    let run = this.store.getPerformanceRun(runId);
    if (!run || run.status === 'stopped') return run;
    if (run.status === 'stopping') {
      return this.store.savePerformanceRun({ ...run, status: 'stopped', finishedAt: new Date().toISOString(), error: '任务已停止' });
    }
    const asset = this.store.getPerformanceAsset(run.assetId);
    const accounts = asset && this.store.getPerformanceAccountPoolCredentials(asset.config.accountPoolId);
    if (!asset || !accounts) return this.store.savePerformanceRun({ ...run, status: 'failed', finishedAt: new Date().toISOString(), error: '性能资产或账号池不可用' });

    run = this.store.savePerformanceRun({ ...run, status: 'running', startedAt: new Date().toISOString(), error: undefined });
    try {
      const result = await this.runner.run({
        runId, asset, accounts,
        onSample: (sample) => this.store.appendPerformanceSample(runId, sample)
      });
      const current = this.store.getPerformanceRun(runId);
      if (current.status === 'stopping') return this.store.savePerformanceRun({ ...current, status: 'stopped', finishedAt: new Date().toISOString(), error: '任务已停止' });
      const verdicts = evaluateThresholds(result.summary, asset.config.thresholds);
      return this.store.savePerformanceRun({
        ...current, status: verdicts.every((verdict) => verdict.passed) ? 'passed' : 'failed',
        summary: { ...result.summary, verdicts }, finishedAt: new Date().toISOString(), error: undefined
      });
    } catch (error) {
      const current = this.store.getPerformanceRun(runId) || run;
      const stopped = current.status === 'stopping';
      return this.store.savePerformanceRun({
        ...current, status: stopped ? 'stopped' : 'failed', finishedAt: new Date().toISOString(),
        error: stopped ? '任务已停止' : error.message
      });
    }
  }

  stop(runId) {
    const run = this.store.getPerformanceRun(runId);
    if (!run) throw new Error('performance run not found');
    if (!['queued', 'running', 'stopping'].includes(run.status)) return run;
    const stopping = this.store.savePerformanceRun({ ...run, status: 'stopping' });
    this.runner.stop?.(runId);
    return stopping;
  }
}
