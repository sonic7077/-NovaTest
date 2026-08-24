import { interpolate } from '../domain/case.js';

const viewports = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 }
};

export const DEFAULT_TIMEOUTS = Object.freeze({ webStepMs: 120000, apiStepMs: 30000, caseMs: 600000 });

function positiveTimeout(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function resolveTimeouts(timeouts = {}) {
  return {
    webStepMs: positiveTimeout(timeouts.webStepMs, DEFAULT_TIMEOUTS.webStepMs),
    apiStepMs: positiveTimeout(timeouts.apiStepMs, DEFAULT_TIMEOUTS.apiStepMs),
    caseMs: positiveTimeout(timeouts.caseMs, DEFAULT_TIMEOUTS.caseMs)
  };
}

export function createTimeoutError(message, code = 'EXECUTION_TIMEOUT') {
  return Object.assign(new Error(message), { code });
}

function timeoutMessage(kind, milliseconds) {
  return kind === 'case'
    ? `用例执行总时长超时（${milliseconds}ms）`
    : `${kind === 'api' ? '接口' : 'Web UI'} 步骤执行超时（${milliseconds}ms）`;
}

function randomSixDigits() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
}

export class RunService {
  constructor(runner, timeouts = {}) {
    this.runner = runner;
    this.timeouts = resolveTimeouts(timeouts);
  }

  createQueuedRun(testCase, { batchId, batchPosition, allowMutations = false } = {}) {
    const id = crypto.randomUUID();
    return {
      id,
      caseId: testCase.id,
      caseName: testCase.name,
      projectId: testCase.projectId,
      target: testCase.target,
      batchId,
      batchPosition,
      allowMutations: Boolean(allowMutations),
      status: 'queued',
      startedAt: null,
      finishedAt: null,
      variables: { runId: id, random6: randomSixDigits() },
      steps: testCase.steps.map((step) => ({ id: step.id, status: 'queued', attempts: 0, logs: [], screenshots: [] }))
    };
  }

  async start(testCase, { project, apiSession, selectedApiIds, allowMutations, worker, run: queuedRun, onUpdate } = {}) {
    const configuredRunner = this.runner[testCase.target] || this.runner;
    const runner = configuredRunner.snapshot ? configuredRunner.snapshot() : configuredRunner;
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
      allowMutations: Boolean(allowMutations ?? run.allowMutations),
      project,
      selectedApiIds,
      worker,
      apiSession: apiSession || (testCase.target === 'api' && typeof runner.createSession === 'function' ? runner.createSession() : undefined)
    };
    const caseDeadline = Date.now() + this.timeouts.caseMs;

    try {
      for (const step of testCase.steps) {
      const stepRun = run.steps.find((item) => item.id === step.id) || { id: step.id, status: 'queued', attempts: 0, logs: [], screenshots: [] };
      if (!run.steps.includes(stepRun)) run.steps.push(stepRun);
      if (step.request?.skipReason && !executionContext.allowMutations) {
        stepRun.status = 'skipped';
        stepRun.error = step.request.skipReason;
        run.status = 'skipped';
        run.finishedAt = new Date().toISOString();
        publish();
        return run;
      }
      stepRun.status = 'running';

      if (Date.now() >= caseDeadline) {
        const error = createTimeoutError(timeoutMessage('case', this.timeouts.caseMs), 'CASE_TIMEOUT');
        stepRun.status = 'failed';
        stepRun.error = error.message;
        stepRun.logs.push({ level: 'error', message: error.message });
        run.status = 'failed';
        run.finishedAt = new Date().toISOString();
        publish();
        return run;
      }

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        stepRun.attempts = attempt;
        executionContext.attempt = attempt;
        publish();
        try {
          const resolvedStep = { ...step, instruction: interpolate(step.instruction, run.variables) };
          const stepTimeoutMs = testCase.target === 'api' ? this.timeouts.apiStepMs : this.timeouts.webStepMs;
          const remainingCaseMs = caseDeadline - Date.now();
          const timeoutMs = Math.min(stepTimeoutMs, remainingCaseMs);
          const timeoutKind = remainingCaseMs <= stepTimeoutMs ? 'case' : testCase.target === 'api' ? 'api' : 'web';
          const evidence = await this.withTimeout(runner.execute(resolvedStep, executionContext), timeoutMs, timeoutMessage(timeoutKind, timeoutKind === 'case' ? this.timeouts.caseMs : stepTimeoutMs), timeoutKind === 'case' ? 'CASE_TIMEOUT' : 'EXECUTION_TIMEOUT');
          Object.assign(run.variables, evidence.variables);
          const { screenshots = [], ...stepEvidence } = evidence;
          Object.assign(stepRun, stepEvidence, { status: 'passed' });
          stepRun.screenshots.push(...screenshots);
          publish();
          break;
        } catch (error) {
          stepRun.error = error.message;
          if (error.api) stepRun.api = error.api;
          if (error.visualChecks) stepRun.visualChecks = error.visualChecks;
          if (error.evidence) stepRun.screenshots.push(error.evidence);
          if (error.evidenceWarning) stepRun.logs.push({ level: 'warn', message: error.evidenceWarning });
          if (error.code === 'PRECONDITION_UNAVAILABLE') {
            stepRun.status = 'skipped';
            run.status = 'skipped';
            run.finishedAt = new Date().toISOString();
            publish();
            return run;
          }
          if (error.code === 'CASE_TIMEOUT') {
            stepRun.status = 'failed';
            run.status = 'failed';
            run.finishedAt = new Date().toISOString();
            publish();
            return run;
          }
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
    } finally {
      await runner.finish?.(executionContext);
    }
  }

  async withTimeout(operation, timeoutMs, message, code) {
    let timer;
    try {
      return await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(createTimeoutError(message, code)), timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
