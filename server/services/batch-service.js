import { RunService } from './run-service.js';

export function resolveBatchStatus(runs) {
  if (runs.every((run) => run?.status === 'passed')) return 'passed';
  if (runs.length > 0 && runs.every((run) => run?.status === 'skipped')) return 'skipped';
  return 'failed';
}

export class BatchService {
  constructor({ runner, store }) {
    this.runner = runner;
    this.store = store;
    this.runService = new RunService(runner);
  }

  async start({ name, projectId, caseIds, cases, allowMutations = false }) {
    const batch = {
      id: crypto.randomUUID(),
      projectId,
      target: cases[0]?.target || null,
      name,
      caseIds: [...caseIds],
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

    await this.execute({ batch, cases, apiSession, selectedApiIds: new Set() });

    batch.status = resolveBatchStatus(batch.runIds.map((runId) => this.store.getRun(runId)));
    batch.finishedAt = new Date().toISOString();
    return this.store.saveBatch(batch);
  }

  async execute({ batch, cases, apiSession, selectedApiIds = new Set(), onRunUpdate }) {
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
}
