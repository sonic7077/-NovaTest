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

    for (const testCase of cases) {
      const run = { ...await this.runService.start(testCase, { apiSession }), caseName: testCase.name };
      this.store.saveRun(run);
      batch.runIds.push(run.id);
      this.store.saveBatch(batch);
    }

    batch.status = batch.runIds.every((runId) => this.store.getRun(runId).status === 'passed') ? 'passed' : 'failed';
    batch.finishedAt = new Date().toISOString();
    return this.store.saveBatch(batch);
  }
}
