import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const htmlPath = fileURLToPath(new URL('../index.html', import.meta.url));
const scriptPath = fileURLToPath(new URL('../app.js', import.meta.url));
const stylesheetPath = fileURLToPath(new URL('../style.css', import.meta.url));

describe('performance testing console', () => {
  it('contains asset, execution, and report controls without exposing account credentials', async () => {
    const [html, script, stylesheet] = await Promise.all([readFile(htmlPath, 'utf8'), readFile(scriptPath, 'utf8'), readFile(stylesheetPath, 'utf8')]);

    expect(html).toContain('href="#/performance-assets"');
    expect(html).toContain('data-route-view="performance-assets"');
    expect(html).toContain('data-route-view="performance-editor"');
    expect(html).toContain('data-route-view="performance-run"');
    expect(html).toContain('id="performanceAssetList"');
    expect(html).toContain('id="performanceAssetForm"');
    expect(html).toContain('id="performanceRunDetail"');
    expect(script).toContain('/api/performance/assets');
    expect(script).toContain('/api/performance/runs');
    expect(script).toContain('function renderPerformanceRun(');
    expect(script).not.toContain('accounts_json');
    expect(stylesheet).toContain('.performance-layout');
    expect(stylesheet).toContain('.performance-metrics');
  });
});
