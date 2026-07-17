import { interpolate } from '../domain/case.js';

const viewports = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 }
};

export class RunService {
  constructor(runner) {
    this.runner = runner;
  }

  async start(testCase) {
    const runner = this.runner[testCase.target] || this.runner;
    const run = {
      id: crypto.randomUUID(),
      caseId: testCase.id,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      variables: {},
      steps: []
    };
    const executionContext = { ...run, testCase, viewport: viewports[testCase.viewport], runId: run.id };

    for (const step of testCase.steps) {
      const stepRun = { id: step.id, status: 'running', attempts: 0, logs: [], screenshots: [] };
      run.steps.push(stepRun);

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        stepRun.attempts = attempt;
        executionContext.attempt = attempt;
        try {
          const resolvedStep = { ...step, instruction: interpolate(step.instruction, run.variables) };
          const evidence = await runner.execute(resolvedStep, executionContext);
          Object.assign(run.variables, evidence.variables);
          const { screenshots = [], ...stepEvidence } = evidence;
          Object.assign(stepRun, stepEvidence, { status: 'passed' });
          stepRun.screenshots.push(...screenshots);
          break;
        } catch (error) {
          stepRun.error = error.message;
          if (error.evidence) stepRun.screenshots.push(error.evidence);
          if (error.evidenceWarning) stepRun.logs.push({ level: 'warn', message: error.evidenceWarning });
          if (attempt === 1) stepRun.logs.push({ level: 'warn', message: `${error.message}; retrying once` });
        }
      }

      if (stepRun.status !== 'passed') {
        stepRun.status = 'failed';
        run.status = 'failed';
        run.finishedAt = new Date().toISOString();
        return run;
      }
    }

    run.status = 'passed';
    run.finishedAt = new Date().toISOString();
    return run;
  }
}
