import { createApp } from './app.js';
import { createProductionRunner } from './runners/production-runner.js';

async function main() {
  let runner;
  try {
    runner = await createProductionRunner();
  } catch (error) {
    runner = { execute: async () => { throw error; } };
    console.warn(`Web UI runner is unavailable: ${error.message}`);
  }
  const port = Number(process.env.PORT || 4173);
  createApp({ runner }).listen(port, '127.0.0.1', () => console.log(`NovaTest is running at http://127.0.0.1:${port}`));
}

main();
