import { interpolate } from '../domain/case.js';

const viewports = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 }
};

export class RunService {
  constructor(runner) {
    this.runner = runner;
  }

  createQueuedRun(testCase, { batchId, batchPosition } = {}) {
    return {
      id: crypto.randomUUID(),
      caseId: testCase.id,
      caseName: testCase.name,
      projectId: testCase.projectId,
      target: testCase.target,
      batchId,
      batchPosition,
      status: 'queued',
      startedAt: null,
      finishedAt: null,
      variables: {},
      steps: testCase.steps.map((step) => ({ id: step.id, status: 'queued', attempts: 0, logs: [], screenshots: [] }))
    };
  }

  async start(testCase, { apiSession, run: queuedRun, onUpdate } = {}) {
    const runner = this.runner[testCase.target] || this.runner;
    const run = queuedRun || this.createQueuedRun(testCase);
    const publish = () => onUpdate?.(structuredClone(run));
    run.status = 'running';
    run.startedAt = new Date().toISOString();
    publish();
    const executionContext = {
      ...run,
      testCase,
      viewport: viewports[testCase.viewport],
      runId: run.id,
      apiSession: apiSession || (testCase.target === 'api' && typeof runner.createSession === 'function' ? runner.createSession() : undefined)
    };

    for (const step of testCase.steps) {
      const stepRun = run.steps.find((item) => item.id === step.id) || { id: step.id, status: 'queued', attempts: 0, logs: [], screenshots: [] };
      if (!run.steps.includes(stepRun)) run.steps.push(stepRun);
      stepRun.status = 'running';

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        stepRun.attempts = attempt;
        executionContext.attempt = attempt;
        publish();
        try {
          const resolvedStep = { ...step, instruction: interpolate(step.instruction, run.variables) };
          const evidence = await runner.execute(resolvedStep, executionContext);
          Object.assign(run.variables, evidence.variables);
          const { screenshots = [], ...stepEvidence } = evidence;
          Object.assign(stepRun, stepEvidence, { status: 'passed' });
          stepRun.screenshots.push(...screenshots);
          publish();
          break;
        } catch (error) {
          stepRun.error = error.message;
          if (error.api) stepRun.api = error.api;
          if (error.evidence) stepRun.screenshots.push(error.evidence);
          if (error.evidenceWarning) stepRun.logs.push({ level: 'warn', message: error.evidenceWarning });
          if (attempt === 1) stepRun.logs.push({ level: 'warn', message: `${error.message}; retrying once` });
          publish();
        }
      }

      if (stepRun.status !== 'passed') {
        stepRun.status = 'failed';
        publish();
        run.status = 'failed';
        run.finishedAt = new Date().toISOString();
        publish();
        return run;
      }
    }

    run.status = 'passed';
    run.finishedAt = new Date().toISOString();
    publish();
    return run;
  }
}
