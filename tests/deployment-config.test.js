import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

describe('deployment configuration', () => {
  it('does not use environment files for business runtime configuration', async () => {
    const compose = await readFile(new URL('../docker-compose.deploy.yml', import.meta.url), 'utf8');
    const pipeline = await readFile(new URL('../.gitlab-ci.yml', import.meta.url), 'utf8');
    const template = await readFile(new URL('../deploy/test.env.example', import.meta.url), 'utf8');

    expect(compose).not.toContain('env_file:');
    expect(compose).not.toContain('AT_APP_PORT');
    expect(pipeline).not.toContain('deploy/test.env');
    expect(template).not.toContain('CMS_BASE_URL=');
    expect(template).not.toContain('MIDSCENE_MODEL_API_KEY=');
    expect(projectRoot).toContain('软件测试自动化平台');
  });
});
