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
    expect(html).toContain('id="projectList"');
    expect(html).toContain('id="createProject"');
    expect(html).toContain('id="caseProjectId"');
    expect(html).toContain('id="deleteCase"');
    expect(html).toContain('id="newWebCaseLink"');
    expect(html).toContain('id="newApiCaseLink"');
    expect(html).toContain('id="assetTargetFilter"');
    expect(html).toContain('id="apiSteps"');
    expect(html).toContain('id="debugApiCase"');
    expect(html).toContain('id="apiRequestPreview"');
    expect(html).toContain('id="batchHistoryList"');
    expect(html).toContain('data-dashboard-target="api"');
    expect(script).toContain('function renderRoute()');
    expect(script).toContain('async function loadEditor');
    expect(script).toContain('async function deleteEditor');
    expect(script).toContain('function readApiCaseFromForm()');
    expect(script).toContain('function renderApiStepNode(');
    expect(script).toContain('const projectRoute = /^#\\/projects\\/');
    expect(script).toContain('async function debugApiCase()');
    expect(script).toContain('async function loadBatchHistory(projectId = activeProjectId)');
    expect(script).toContain('`/api/batches?projectId=${encodeURIComponent(projectId)}`');
    expect(script).toContain('async function loadProjects()');
    expect(script).toContain("'/api/projects'");
    expect(script).toContain('#/projects/');
    expect(stylesheet).toContain('.api-request { grid-template-columns: 28px minmax(0, 1fr); }');
    expect(stylesheet).toContain('.api-request .step-content { min-width: 0; }');
    expect(script).toContain("target === 'api' ? '接口用例编排' : 'Web UI 用例编排'");
    expect(script).toContain('function updateEditorBreadcrumb()');
    expect(stylesheet).toContain('@media (max-width: 760px)');
    expect(stylesheet.length).toBeGreaterThan(5000);
  });
});
