import { RunService } from './run-service.js';
import { IsolatedBrowserWorkerPool } from './isolated-browser-worker-pool.js';

function batchPlan(cases, multiplier = 1) {
  return {
    plannedCaseCount: cases.length * multiplier,
    plannedStepCount: cases.reduce((total, testCase) => total + testCase.steps.length, 0) * multiplier
  };
}

export function resolveBatchStatus(runs) {
  if (runs.every((run) => run?.status === 'passed')) return 'passed';
  if (runs.length > 0 && runs.every((run) => run?.status === 'skipped')) return 'skipped';
  return 'failed';
}

export class BatchService {
  constructor({ runner, store, timeouts }) {
    this.runner = runner;
    this.store = store;
    this.timeouts = timeouts;
    this.runService = new RunService(runner, timeouts);
  }

  async start({ name, projectId, caseIds, cases, allowMutations = false, webWorkers }) {
    const workerCount = cases[0]?.target === 'web' && webWorkers?.accounts?.length ? webWorkers.accounts.length : 1;
    const batch = {
      id: crypto.randomUUID(),
      projectId,
      target: cases[0]?.target || null,
      name,
      caseIds: [...caseIds],
      ...batchPlan(cases, workerCount),
      status: 'running',
      runIds: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      allowMutations: Boolean(allowMutations)
    };
    this.store.saveBatch(batch);
    const apiRunner = this.runner.api;
    const apiSession = cases[0]?.target === 'api' && typeof apiRunner?.createSession === 'function'
      ? apiRunner.createSession()
      : undefined;

    await this.execute({ batch, cases, apiSession, selectedApiIds: new Set(), webWorkers });

    batch.status = resolveBatchStatus(batch.runIds.map((runId) => this.store.getRun(runId)));
    batch.finishedAt = new Date().toISOString();
    return this.store.saveBatch(batch);
  }

  async execute({ batch, cases, apiSession, selectedApiIds = new Set(), onRunUpdate, webWorkers }) {
    if (batch.target === 'web' && webWorkers?.accounts?.length) {
      return this.executeWebWorkers({ batch, cases, webWorkers, onRunUpdate });
    }
    for (const [batchPosition, testCase] of cases.entries()) {
      const queuedRun = this.runService.createQueuedRun(testCase, { batchId: batch.id, batchPosition, allowMutations: batch.allowMutations });
      this.store.saveRun(queuedRun);
      batch.runIds.push(queuedRun.id);
      this.store.saveBatch(batch);

      const run = await this.runService.start(testCase, {
        project: this.store.getProject(testCase.projectId),
        apiSession,
        selectedApiIds,
        allowMutations: batch.allowMutations,
        run: queuedRun,
        onUpdate: (update) => {
          this.store.saveRun(update);
          onRunUpdate?.(update);
        }
      });
      this.store.saveRun(run);
      onRunUpdate?.(run);
    }
    return batch;
  }

  async executeWebWorkers({ batch, cases, webWorkers, onRunUpdate }) {
    const workerStates = new Map();
    const persistWorkerSummary = () => {
      const workers = [...workerStates.values()];
      batch.workerSummary = {
        total: webWorkers.accounts.length,
        passed: workers.filter((worker) => worker.status === 'passed').length,
        failed: workers.filter((worker) => ['failed', 'timedOut'].includes(worker.status)).length,
        timedOut: workers.filter((worker) => worker.status === 'timedOut').length,
        messageCount: workers.reduce((total, worker) => total + (worker.messageCount || 0), 0),
        imagePassed: workers.filter((worker) => worker.image?.status === 'passed').length,
        workers
      };
      this.store.saveBatch(batch);
    };
    const pool = new IsolatedBrowserWorkerPool({
      maxConcurrency: webWorkers.maxConcurrency,
      workerTimeoutMs: webWorkers.workerTimeoutMs,
      workerFactory: async (task) => {
        const configuredRunner = this.runner.web?.snapshot?.() || this.runner.web || this.runner;
        const workerRunner = await configuredRunner.createWorker?.({ viewport: { width: 1440, height: 900 } });
        const runner = workerRunner || configuredRunner;
        const runService = new RunService(runner, this.timeouts);
        return {
          run: async () => {
            const runIds = [];
            const runs = [];
            for (const [caseIndex, testCase] of cases.entries()) {
              const queuedRun = runService.createQueuedRun(testCase, {
                batchId: batch.id,
                batchPosition: `${task.workerId}:${caseIndex}`,
                allowMutations: batch.allowMutations
              });
              queuedRun.workerId = task.workerId;
              this.store.saveRun(queuedRun);
              batch.runIds.push(queuedRun.id);
              runIds.push(queuedRun.id);
              this.store.saveBatch(batch);
              const run = await runService.start(testCase, {
                project: this.store.getProject(testCase.projectId),
                allowMutations: batch.allowMutations,
                worker: { workerId: task.workerId, account: task.account },
                run: queuedRun,
                onUpdate: (update) => {
                  update.workerId = task.workerId;
                  this.store.saveRun(update);
                  onRunUpdate?.(update);
                }
              });
              this.store.saveRun(run);
              runs.push(run);
              onRunUpdate?.(run);
            }
            return {
              status: runs.every((run) => run.status === 'passed') ? 'passed' : 'failed',
              runIds,
              messageCount: Number(task.input?.messageCount) || 0,
              image: task.input?.image || { status: 'skipped' }
            };
          },
          close: async () => workerRunner?.close?.()
        };
      }
    });
    const result = await pool.run(webWorkers.accounts.map((account, index) => ({
      workerId: `worker-${index + 1}`,
      account,
      input: { messageCount: webWorkers.messageCount, image: webWorkers.image }
    })), {
      onWorkerUpdate: (worker) => {
        workerStates.set(worker.workerId, worker);
        persistWorkerSummary();
      }
    });
    batch.workerSummary = result;
    this.store.saveBatch(batch);
    return batch;
  }
}
