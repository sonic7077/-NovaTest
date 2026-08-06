import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const deploymentReadme = `# NovaTest 数据包部署说明

本压缩包包含 SQLite 数据库和校验清单，用于在服务器端恢复测试资产、环境配置、执行记录与报告数据。

1. 解压压缩包到平台部署目录。
2. 使用压缩包内的 \`data/novatest.db\` 覆盖部署目录的同名数据库文件。
3. 对照 \`manifest.json\` 中的 \`sha256\` 校验数据库文件完整性。
4. 重启平台服务；服务启动后会保留已有数据并同步代码内置的种子用例。
`;

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
    await writeFile(join(temporaryRoot, 'README.md'), deploymentReadme);
    await execFileAsync('tar', ['-czf', archivePath, '-C', temporaryRoot, 'data/novatest.db', 'manifest.json', 'README.md']);
    return { archivePath, sha256 };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
