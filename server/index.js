import 'dotenv/config';
import { createApp } from './app.js';
import { createProductionRunner } from './runners/production-runner.js';
import { createFileStore } from './storage/file-store.js';

async function main() {
  let runner;
  let runnerStatus;
  try {
    runner = await createProductionRunner();
    runnerStatus = { ready: true, message: 'Midscene Web runner is ready' };
  } catch (error) {
    runner = { execute: async () => { throw error; } };
    runnerStatus = { ready: false, message: error.message };
    console.warn(`Web UI runner is unavailable: ${error.message}`);
  }
  const port = Number(process.env.PORT || 4173);
  const store = createFileStore('data/store.json');
  createApp({ runner, store, runnerStatus }).listen(port, '127.0.0.1', () => console.log(`NovaTest is running at http://127.0.0.1:${port}`));
}

main();
