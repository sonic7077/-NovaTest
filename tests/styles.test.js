import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesheetPath = fileURLToPath(new URL('../style.css', import.meta.url));

describe('test console stylesheet', () => {
  it('defines the base layout, editor and responsive rules', async () => {
    const stylesheet = await readFile(stylesheetPath, 'utf8');

    expect(stylesheet).toContain(':root');
    expect(stylesheet).toContain('.sidebar');
    expect(stylesheet).toContain('.workspace-grid');
    expect(stylesheet).toContain('.case-editor');
    expect(stylesheet).toContain('@media (max-width: 760px)');
    expect(stylesheet.length).toBeGreaterThan(5000);
  });
});
