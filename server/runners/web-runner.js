const supportedKinds = new Set(['action', 'assert', 'query']);

export function createWebRunner({ browser, agentFactory, screenshotDir = 'data/evidence' }) {
  return {
    async execute(step, context) {
      if (!supportedKinds.has(step.kind)) throw new Error(`unsupported web step kind: ${step.kind}`);

      const isNewPage = !context.page;
      const page = context.page ?? await browser.newPage({ viewport: context.viewport });
      context.page = page;
      if (isNewPage && context.testCase?.baseUrl) await page.goto(context.testCase.baseUrl);
      const agent = agentFactory(page);
      let variables;

      if (step.kind === 'action') await agent.aiAct(step.instruction);
      if (step.kind === 'assert') await agent.aiAssert(step.instruction);
      if (step.kind === 'query') variables = await agent.aiQuery(step.instruction);

      const screenshot = await page.screenshot({ path: `${screenshotDir}/${step.id}.png` });
      return { variables, screenshot };
    }
  };
}
