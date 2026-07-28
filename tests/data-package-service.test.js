import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDataPackage } from '../server/services/data-package-service.js';

const execFileAsync = promisify(execFile);

describe('data package service', () => {
  it('archives exactly the SQLite database and checksum manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'novatest-data-package-'));
    const databasePath = join(directory, 'novatest.db');
    const outputDir = join(directory, 'artifacts');
    try {
      await writeFile(databasePath, 'SQLite format 3\u0000test-data');
      const result = await createDataPackage({ databasePath, outputDir, timestamp: '20260728-120000' });
      const { stdout: entries } = await execFileAsync('tar', ['-tzf', result.archivePath]);
      const { stdout: manifest } = await execFileAsync('tar', ['-xOzf', result.archivePath, 'manifest.json']);

      expect(entries.trim().split('\n').sort()).toEqual(['data/novatest.db', 'manifest.json']);
      expect(manifest).toContain(result.sha256);
      expect(await readdir(outputDir)).toEqual(['novatest-data-20260728-120000.tar.gz']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
