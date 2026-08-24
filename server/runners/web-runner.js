import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const supportedKinds = new Set(['action', 'assert', 'query']);

function referencePrompt(step, assetPaths) {
  if (!assetPaths.length) return step.instruction;
  const context = step.kind === 'assert'
    ? '参考图片代表预期结果。请在此前操作完成后的当前页面验证步骤目标。'
    : '参考图片仅用于辅助识别、定位和理解页面；请以步骤目标为准继续执行操作。';
  return {
    prompt: `${context}\n步骤目标：${step.instruction}`,
    images: assetPaths.map((url, index) => ({ name: `参考图片 ${index + 1}`, url })),
    convertHttpImage2Base64: true
  };
}

function comparisonPrompt(step, visualCheck, assetPath) {
  return {
    prompt: `根据当前页面、步骤目标和参考图片做语义校验。步骤目标：${step.instruction}\n参考图片说明：${visualCheck.description}\n忽略时间、随机编号、广告和非关键动态文案；若无法可靠判断则失败。`,
    images: [{ name: '参考图片 1', url: assetPath }],
    convertHttpImage2Base64: true
  };
}

function visualReason(result) {
  return result?.message || result?.thought || '参考图片与当前页面状态一致';
}

export function createWebRunner({ browser, agentFactory, beforeFirstStep, screenshotDir = 'data/evidence', resolveAssetPath } = {}) {
  async function openSession(context, step) {
    if (context.page) return context.page;
    if (context.workerSession) {
      context.page = context.workerSession.page;
      context.webSession = context.workerSession;
      try {
        if (context.testCase?.baseUrl && !context.workerSession.navigated) {
          await context.workerSession.page.goto(context.testCase.baseUrl);
          context.workerSession.navigated = true;
        }
        if (beforeFirstStep && !context.workerSession.webLoginStarted) {
          await beforeFirstStep(context.workerSession.page, context);
          context.workerSession.webLoginStarted = true;
        }
      } catch (error) {
        if (step) {
          try { error.evidence = await capture(context.workerSession.page, step, context, 'failed'); }
          catch (captureError) { error.evidenceWarning = `截图保存失败：${captureError.message}`; }
        }
        throw error;
      }
      return context.workerSession.page;
    }
    const session = browser.openPage
      ? await browser.openPage({ viewport: context.viewport })
      : { page: await browser.newPage({ viewport: context.viewport }), close: async () => {} };
    context.page = session.page;
    context.webSession = session;
    try {
      if (context.testCase?.baseUrl) await session.page.goto(context.testCase.baseUrl);
      if (beforeFirstStep && !context.webLoginStarted) {
        await beforeFirstStep(session.page, context);
        context.webLoginStarted = true;
      }
    } catch (error) {
      if (step) {
        try {
          error.evidence = await capture(session.page, step, context, 'failed');
        } catch (captureError) {
          error.evidenceWarning = `截图保存失败：${captureError.message}`;
        }
      }
      try { await session.close(); } catch {}
      delete context.page;
      delete context.webSession;
      delete context.webLoginStarted;
      delete context.webSessionClosed;
      throw error;
    }
    return session.page;
  }

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

  const runner = {
    async execute(step, context) {
      if (!supportedKinds.has(step.kind)) throw new Error(`unsupported web step kind: ${step.kind}`);

      const page = await openSession(context, step);
      const agent = agentFactory(page);
      try {
        const visualChecks = step.visualChecks || [];
        const assetPaths = visualChecks.map((visualCheck) => resolveAssetPath?.(visualCheck.assetPath));
        const unavailable = visualChecks.find((visualCheck, index) => !assetPaths[index]);
        if (unavailable) throw new Error(`reference image unavailable: ${unavailable.assetPath}`);
        const prompt = referencePrompt(step, assetPaths);
        let variables;
        if (step.kind === 'action') await agent.aiAct(prompt);
        if (step.kind === 'assert') await agent.aiAssert(prompt);
        if (step.kind === 'query') variables = await agent.aiQuery(prompt);

        const evidence = await capture(page, step, context, 'passed');
        const visualResults = [];
        for (const [index, visualCheck] of visualChecks.entries()) {
          try {
            const result = await agent.aiAssert(comparisonPrompt(step, visualCheck, assetPaths[index]));
            const reason = visualReason(result);
            if (result?.pass === false) throw new Error(reason);
            visualResults.push({ id: visualCheck.id, status: 'passed', reason, baselinePath: visualCheck.assetPath, screenshot: evidence.path });
          } catch (error) {
            const reason = error.message || '参考图片校验失败';
            visualResults.push({ id: visualCheck.id, status: 'failed', reason, baselinePath: visualCheck.assetPath, screenshot: evidence.path });
            error.visualChecks = visualResults;
            throw error;
          }
        }
        return { variables, screenshot: evidence.path, screenshots: [evidence], visualChecks: visualResults };
      } catch (error) {
        try {
          error.evidence = await capture(page, step, context, 'failed');
        } catch (captureError) {
          error.evidenceWarning = `截图保存失败：${captureError.message}`;
        }
        throw error;
      }
    },

    async finish(context) {
      const session = context?.webSession;
      if (!session || context.webSessionClosed) return;
      context.webSessionClosed = true;
      await session.close();
    }
  };

  runner.createWorker = async ({ viewport } = {}) => {
    const session = browser.openContext
      ? await browser.openContext({ viewport })
      : await browser.openPage({ viewport });
    return {
      execute(step, context) {
        return runner.execute(step, { ...context, workerSession: session });
      },
      finish: async () => {},
      close: async () => session.close()
    };
  };

  return runner;
}
