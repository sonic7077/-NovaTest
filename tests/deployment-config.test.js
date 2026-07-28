import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

describe('deployment configuration template', () => {
  it('documents server-only encryption and CMS runner settings', async () => {
    const template = await readFile(new URL('../deploy/test.env.example', import.meta.url), 'utf8');

    expect(template).toContain('PLATFORM_CONFIG_ENCRYPTION_KEY=');
    expect(template).toContain('CMS_BASE_URL=');
    expect(projectRoot).toContain('软件测试自动化平台');
  });
});
