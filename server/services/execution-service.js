import { BatchService } from './batch-service.js';
import { RunService } from './run-service.js';

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
  constructor({ runner, store, schedule = setImmediate }) {
    this.runner = runner;
    this.store = store;
    this.schedule = schedule;
    this.runService = new RunService(runner);
    this.batchService = new BatchService({ runner, store });
  }

  queueRun(testCase, { allowMutations = false } = {}) {
    const run = this.runService.createQueuedRun(testCase, { allowMutations });
    this.store.saveRun(run);
    this.schedule(() => { void this.executeRun(testCase, run); });
    return run;
  }

  queueBatch({ name, projectId, target, caseIds, cases, allowMutations = false }) {
    const batch = {
      id: crypto.randomUUID(),
      name,
      projectId,
      target: target || cases[0]?.target || null,
      caseIds: [...caseIds],
      status: 'queued',
      runIds: [],
      startedAt: null,
      finishedAt: null,
      allowMutations: Boolean(allowMutations)
    };
    this.store.saveBatch(batch);
    this.schedule(() => { void this.executeBatch(batch, cases); });
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

  async executeBatch(batch, cases) {
    batch.status = 'running';
    batch.startedAt = new Date().toISOString();
    this.store.saveBatch(batch);
    const apiRunner = this.runner.api;
    const apiSession = batch.target === 'api' && typeof apiRunner?.createSession === 'function'
      ? apiRunner.createSession()
      : undefined;

    try {
      await this.batchService.execute({ batch, cases, apiSession });
      batch.status = batch.runIds.every((runId) => this.store.getRun(runId)?.status === 'passed') ? 'passed' : 'failed';
    } catch (error) {
      batch.status = 'failed';
      batch.error = error.message;
    }

    batch.finishedAt = new Date().toISOString();
    return this.store.saveBatch(batch);
  }
}
