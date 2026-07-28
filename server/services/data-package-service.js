import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function packageTimestamp(value = new Date()) {
  return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '').replace('T', '-');
}

export async function createDataPackage({ databasePath = 'data/novatest.db', outputDir = 'artifacts', timestamp = packageTimestamp() } = {}) {
  await access(databasePath);
  const database = await readFile(databasePath);
  const sha256 = createHash('sha256').update(database).digest('hex');
  const archivePath = join(outputDir, `novatest-data-${timestamp}.tar.gz`);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'novatest-data-package-'));

  try {
    await mkdir(join(temporaryRoot, 'data'), { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await copyFile(databasePath, join(temporaryRoot, 'data', 'novatest.db'));
    await writeFile(join(temporaryRoot, 'manifest.json'), `${JSON.stringify({ database: 'data/novatest.db', sha256 }, null, 2)}\n`);
    await execFileAsync('tar', ['-czf', archivePath, '-C', temporaryRoot, 'data/novatest.db', 'manifest.json']);
    return { archivePath, sha256 };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
