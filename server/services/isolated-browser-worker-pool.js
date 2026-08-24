const DEFAULT_MAX_CONCURRENCY = 10;
const DEFAULT_WORKER_TIMEOUT_MS = 600000;

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function workerResult(task, startedAt, result = {}) {
  const finishedAt = new Date().toISOString();
  return {
    workerId: task.workerId || crypto.randomUUID(),
    account: publicAccount(task.account),
    status: result.status || 'passed',
    messageCount: Number(result.messageCount) || 0,
    image: result.image || { status: 'skipped' },
    runIds: Array.isArray(result.runIds) ? result.runIds : [],
    startedAt,
    finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
    ...(result.error ? { error: result.error } : {}),
    ...(result.cleanupError ? { cleanupError: result.cleanupError } : {})
  };
}

function publicAccount(account) {
  if (!account) return undefined;
  const { password: _password, totpSecret: _totpSecret, ...safe } = account;
  return safe;
}

export class IsolatedBrowserWorkerPool {
  constructor({ workerFactory, maxConcurrency = DEFAULT_MAX_CONCURRENCY, workerTimeoutMs = DEFAULT_WORKER_TIMEOUT_MS } = {}) {
    if (typeof workerFactory !== 'function') throw new Error('workerFactory is required');
    this.workerFactory = workerFactory;
    this.maxConcurrency = Math.min(DEFAULT_MAX_CONCURRENCY, Math.max(1, positiveInteger(maxConcurrency, DEFAULT_MAX_CONCURRENCY)));
    this.workerTimeoutMs = positiveInteger(workerTimeoutMs, DEFAULT_WORKER_TIMEOUT_MS);
  }

  async run(tasks = [], { onWorkerUpdate } = {}) {
    const workers = [];
    let cursor = 0;
    const executeNext = async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor++];
        const startedAt = new Date().toISOString();
        const workerId = task.workerId || crypto.randomUUID();
        const normalizedTask = { ...task, workerId };
        onWorkerUpdate?.({ workerId, account: publicAccount(normalizedTask.account), status: 'running', startedAt });
        let worker;
        let result;
        try {
          worker = await this.workerFactory(normalizedTask);
          const operation = Promise.resolve(worker.run(normalizedTask));
          let timer;
          try {
            result = await Promise.race([
              operation,
              new Promise((_, reject) => {
                timer = setTimeout(() => {
                  const timeoutError = new Error(`Worker 执行超时（${this.workerTimeoutMs}ms）`);
                  timeoutError.code = 'WORKER_TIMEOUT';
                  reject(timeoutError);
                }, this.workerTimeoutMs);
              })
            ]);
          } finally {
            clearTimeout(timer);
          }
        } catch (error) {
          result = {
            status: error.code === 'WORKER_TIMEOUT' ? 'timedOut' : 'failed',
            error: error.message
          };
        } finally {
          try {
            await worker?.close?.();
          } catch (error) {
            result = { ...(result || { status: 'failed', error: 'Worker 执行失败' }), cleanupError: error.message };
          }
        }
        const completed = workerResult(normalizedTask, startedAt, result || {});
        workers.push(completed);
        onWorkerUpdate?.(completed);
      }
    };

    await Promise.all(Array.from({ length: Math.min(this.maxConcurrency, tasks.length) }, () => executeNext()));
    const passed = workers.filter((worker) => worker.status === 'passed').length;
    const timedOut = workers.filter((worker) => worker.status === 'timedOut').length;
    return {
      total: workers.length,
      passed,
      failed: workers.length - passed,
      timedOut,
      messageCount: workers.reduce((total, worker) => total + worker.messageCount, 0),
      imagePassed: workers.filter((worker) => worker.image?.status === 'passed').length,
      workers: workers.sort((a, b) => String(a.workerId).localeCompare(String(b.workerId)))
    };
  }
}

export function createWorkerTask({ workerId, account, testCaseIds = [], input = {} } = {}) {
  return { workerId: workerId || crypto.randomUUID(), account, testCaseIds: [...testCaseIds], input };
}
