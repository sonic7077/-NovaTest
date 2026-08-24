import { BatchService, resolveBatchStatus } from './batch-service.js';
import { RunService } from './run-service.js';

function batchPlan(cases, multiplier = 1) {
  return {
    plannedCaseCount: cases.length * multiplier,
    plannedStepCount: cases.reduce((total, testCase) => total + testCase.steps.length, 0) * multiplier
  };
}

function failRun(run, error) {
  const activeStep = run.steps.find((step) => ['queued', 'running'].includes(step.status));
  if (activeStep) {
    activeStep.status = 'failed';
    activeStep.error = error.message;
    activeStep.logs.push({ level: 'error', message: error.message });
  }
  run.status = 'failed';
  run.finishedAt = new Date().toISOString();
  return run;
}

export class ExecutionService {
  constructor({ runner, store, schedule = setImmediate, timeouts }) {
    this.runner = runner;
    this.store = store;
    this.schedule = schedule;
    this.runService = new RunService(runner, timeouts);
    this.batchService = new BatchService({ runner, store, timeouts });
  }

  queueRun(testCase, { allowMutations = false } = {}) {
    const run = this.runService.createQueuedRun(testCase, { allowMutations });
    this.store.saveRun(run);
    this.schedule(() => { void this.executeRun(testCase, run); });
    return run;
  }

  queueBatch({ name, projectId, target, caseIds, cases, allowMutations = false, webWorkers }) {
    const workerCount = target === 'web' && webWorkers?.accounts?.length ? webWorkers.accounts.length : 1;
    const batch = {
      id: crypto.randomUUID(),
      name,
      projectId,
      target: target || cases[0]?.target || null,
      caseIds: [...caseIds],
      ...batchPlan(cases, workerCount),
      status: 'queued',
      runIds: [],
      startedAt: null,
      finishedAt: null,
      allowMutations: Boolean(allowMutations),
      ...(target === 'web' && webWorkers?.accounts?.length ? {
        workerConfig: {
          workerCount,
          maxConcurrency: webWorkers.maxConcurrency,
          workerTimeoutMs: webWorkers.workerTimeoutMs
        }
      } : {})
    };
    this.store.saveBatch(batch);
    this.schedule(() => { void this.executeBatch(batch, cases, webWorkers); });
    return batch;
  }

  async executeRun(testCase, run) {
    try {
      return await this.runService.start(testCase, {
        run,
        project: this.store.getProject(testCase.projectId),
        onUpdate: (update) => this.store.saveRun(update)
      });
    } catch (error) {
      const failed = failRun(run, error);
      this.store.saveRun(failed);
      return failed;
    }
  }

  async executeBatch(batch, cases, webWorkers) {
    batch.status = 'running';
    batch.startedAt = new Date().toISOString();
    this.store.saveBatch(batch);
    const apiRunner = this.runner.api;
    const apiSession = batch.target === 'api' && typeof apiRunner?.createSession === 'function'
      ? apiRunner.createSession()
      : undefined;

    try {
      await this.batchService.execute({ batch, cases, apiSession, webWorkers });
      batch.status = resolveBatchStatus(batch.runIds.map((runId) => this.store.getRun(runId)));
    } catch (error) {
      batch.status = 'failed';
      batch.error = error.message;
    }

    batch.finishedAt = new Date().toISOString();
    return this.store.saveBatch(batch);
  }
}
