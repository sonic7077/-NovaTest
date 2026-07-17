import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const supportedKinds = new Set(['action', 'assert', 'query']);

export function createWebRunner({ browser, agentFactory, screenshotDir = 'data/evidence' }) {
  async function capture(page, step, context, phase) {
    const runId = context.runId;
    const attempt = context.attempt || 1;
    const filename = runId ? `${step.id}-attempt-${attempt}.png` : `${step.id}.png`;
    const relativePath = runId ? `${runId}/${filename}` : filename;
    const directory = runId ? join(screenshotDir, runId) : screenshotDir;
    if (runId) await mkdir(directory, { recursive: true });
    await page.screenshot({ path: join(directory, filename) });
    return { path: relativePath, attempt, phase };
  }

  return {
    async execute(step, context) {
      if (!supportedKinds.has(step.kind)) throw new Error(`unsupported web step kind: ${step.kind}`);

      const isNewPage = !context.page;
      const page = context.page ?? await browser.newPage({ viewport: context.viewport });
      context.page = page;
      if (isNewPage && context.testCase?.baseUrl) await page.goto(context.testCase.baseUrl);
      const agent = agentFactory(page);
      try {
        let variables;
        if (step.kind === 'action') await agent.aiAct(step.instruction);
        if (step.kind === 'assert') await agent.aiAssert(step.instruction);
        if (step.kind === 'query') variables = await agent.aiQuery(step.instruction);

        const evidence = await capture(page, step, context, 'passed');
        return { variables, screenshot: evidence.path, screenshots: [evidence] };
      } catch (error) {
        try {
          error.evidence = await capture(page, step, context, 'failed');
        } catch (captureError) {
          error.evidenceWarning = `截图保存失败：${captureError.message}`;
        }
        throw error;
      }
    }
  };
}
