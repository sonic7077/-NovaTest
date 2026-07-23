import { RunService } from './run-service.js';

export class BatchService {
  constructor({ runner, store }) {
    this.runner = runner;
    this.store = store;
    this.runService = new RunService(runner);
  }

  async start({ name, projectId, caseIds, cases }) {
    const batch = {
      id: crypto.randomUUID(),
      projectId,
      target: cases[0]?.target || null,
      name,
      caseIds: [...caseIds],
      status: 'running',
      runIds: [],
      startedAt: new Date().toISOString(),
      finishedAt: null
    };
    this.store.saveBatch(batch);
    const apiRunner = this.runner.api;
    const apiSession = cases[0]?.target === 'api' && typeof apiRunner?.createSession === 'function'
      ? apiRunner.createSession()
      : undefined;

    await this.execute({ batch, cases, apiSession });

    batch.status = batch.runIds.every((runId) => this.store.getRun(runId).status === 'passed') ? 'passed' : 'failed';
    batch.finishedAt = new Date().toISOString();
    return this.store.saveBatch(batch);
  }

  async execute({ batch, cases, apiSession, onRunUpdate }) {
    for (const [batchPosition, testCase] of cases.entries()) {
      const queuedRun = this.runService.createQueuedRun(testCase, { batchId: batch.id, batchPosition });
      this.store.saveRun(queuedRun);
      batch.runIds.push(queuedRun.id);
      this.store.saveBatch(batch);

      const run = await this.runService.start(testCase, {
        apiSession,
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
}
