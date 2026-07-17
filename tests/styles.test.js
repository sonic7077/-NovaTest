import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesheetPath = fileURLToPath(new URL('../style.css', import.meta.url));
const htmlPath = fileURLToPath(new URL('../index.html', import.meta.url));
const scriptPath = fileURLToPath(new URL('../app.js', import.meta.url));

describe('test console stylesheet', () => {
  it('defines the base layout, editor and responsive rules', async () => {
    const stylesheet = await readFile(stylesheetPath, 'utf8');
    const html = await readFile(htmlPath, 'utf8');
    const script = await readFile(scriptPath, 'utf8');

    expect(stylesheet).toContain(':root');
    expect(stylesheet).toContain('.sidebar');
    expect(stylesheet).toContain('.workspace-grid');
    expect(stylesheet).toContain('.case-editor');
    expect(stylesheet).toContain('.asset-selection');
    expect(stylesheet).toContain('.batch-history');
    expect(stylesheet).toContain('.route-view');
    expect(stylesheet).toContain('.assets-table');
    expect(html).toContain('#/dashboard');
    expect(html).toContain('#/assets');
    expect(html).toContain('data-route-view="dashboard"');
    expect(html).toContain('data-route-view="asset-editor"');
    expect(html).toContain('id="assetSearch"');
    expect(html).toContain('id="createCase"');
    expect(html).toContain('id="deleteCase"');
    expect(script).toContain('function renderRoute()');
    expect(script).toContain('async function loadEditor');
    expect(script).toContain('async function deleteEditor');
    expect(stylesheet).toContain('@media (max-width: 760px)');
    expect(stylesheet.length).toBeGreaterThan(5000);
  });
});
