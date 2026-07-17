import { RunService } from './run-service.js';

export class BatchService {
  constructor({ runner, store }) {
    this.store = store;
    this.runService = new RunService(runner);
  }

  async start({ name, caseIds, cases }) {
    const batch = {
      id: crypto.randomUUID(),
      name,
      caseIds: [...caseIds],
      status: 'running',
      runIds: [],
      startedAt: new Date().toISOString(),
      finishedAt: null
    };
    this.store.saveBatch(batch);

    for (const testCase of cases) {
      const run = { ...await this.runService.start(testCase), caseName: testCase.name };
      this.store.saveRun(run);
      batch.runIds.push(run.id);
      this.store.saveBatch(batch);
    }

    batch.status = batch.runIds.every((runId) => this.store.getRun(runId).status === 'passed') ? 'passed' : 'failed';
    batch.finishedAt = new Date().toISOString();
    return this.store.saveBatch(batch);
  }
}
