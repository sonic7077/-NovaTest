import { spawn as spawnProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scenarioPath = fileURLToPath(new URL('../performance/daygf-mixed-scenario.js', import.meta.url));

function metricValue(metrics, name, key, fallback = 0) {
  const value = metrics?.[name]?.values?.[key];
  return Number.isFinite(value) ? value : fallback;
}

function summarize(k6Summary) {
  const metrics = k6Summary?.metrics || {};
  return {
    requests: metricValue(metrics, 'http_reqs', 'count'),
    failures: metricValue(metrics, 'http_req_failed', 'rate'),
    p95Ms: Math.round(metricValue(metrics, 'http_req_duration', 'p(95)')),
    loginSuccessRate: metricValue(metrics, 'novatest_login_success', 'rate'),
    readSuccessRate: metricValue(metrics, 'novatest_read_success', 'rate'),
    writeSuccessRate: metricValue(metrics, 'novatest_write_success', 'rate'),
    serverErrorRate: metricValue(metrics, 'novatest_server_errors', 'rate')
  };
}

export class K6PerformanceRunner {
  constructor({ k6Path = process.env.K6_BIN || 'k6', spawnImpl = spawnProcess, temporaryDirectory = tmpdir() } = {}) {
    this.k6Path = k6Path;
    this.spawnImpl = spawnImpl;
    this.temporaryDirectory = temporaryDirectory;
    this.children = new Map();
  }

  async run({ runId, asset, accounts, onSample = () => undefined }) {
    const workingDirectory = await mkdtemp(join(this.temporaryDirectory, 'novatest-k6-'));
    const inputPath = join(workingDirectory, 'input.json');
    const summaryPath = join(workingDirectory, 'summary.json');
    await writeFile(inputPath, JSON.stringify({ asset, accounts }), { mode: 0o600 });

    try {
      const output = await new Promise((resolve, reject) => {
        const child = this.spawnImpl(this.k6Path, ['run', '--quiet', '--summary-export', summaryPath, scenarioPath], {
          cwd: dirname(scenarioPath), shell: false,
          env: { ...process.env, NOVATEST_INPUT_FILE: inputPath }
        });
        this.children.set(runId, child);
        child.once('error', (error) => {
          reject(error?.code === 'ENOENT' ? new Error('k6 is unavailable: install k6 or set K6_BIN') : error);
        });
        child.once('close', async (code) => {
          try {
            if (code !== 0) throw new Error(`k6 exited with code ${code}`);
            const rawSummary = JSON.parse(await readFile(summaryPath, 'utf8'));
            resolve(summarize(rawSummary));
          } catch (error) {
            reject(error);
          }
        });
      });
      const sample = { elapsedSeconds: 0, activeVus: 0, ...output, phase: 'completed' };
      onSample(sample);
      return { summary: output, artifactPath: undefined };
    } finally {
      this.children.delete(runId);
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  stop(runId) {
    const child = this.children.get(runId);
    return child ? child.kill('SIGTERM') : false;
  }
}
