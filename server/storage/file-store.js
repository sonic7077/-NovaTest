import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function emptyData() {
  return { projects: {}, cases: {}, runs: {}, batches: {} };
}

export function createFileStore(filePath) {
  function load() {
    const raw = existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : {};
    const data = { ...emptyData(), ...raw };
    data.projects ||= {};
    let changed = false;
    let defaultProject = Object.values(data.projects).find((project) => project.name === '默认项目');
    if (!defaultProject) {
      const timestamp = new Date().toISOString();
      defaultProject = { id: crypto.randomUUID(), name: '默认项目', createdAt: timestamp, updatedAt: timestamp };
      data.projects[defaultProject.id] = defaultProject;
      changed = true;
    }
    Object.entries(data.cases).forEach(([key, testCase]) => {
      const id = testCase.id || (key === 'undefined' ? crypto.randomUUID() : key);
      const saved = { ...testCase, id, projectId: testCase.projectId || defaultProject.id };
      data.cases[id] = saved;
      if (id !== key) delete data.cases[key];
      if (id !== testCase.id || saved.projectId !== testCase.projectId) changed = true;
    });
    Object.entries(data.batches).forEach(([key, batch]) => {
      if (batch.projectId) return;
      data.batches[key] = { ...batch, projectId: defaultProject.id };
      changed = true;
    });
    if (changed) save(data);
    return data;
  }

  function save(data) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  return {
    saveCase(testCase) {
      const data = load();
      const defaultProject = Object.values(data.projects).find((project) => project.name === '默认项目');
      const saved = { ...testCase, id: testCase.id || crypto.randomUUID(), projectId: testCase.projectId || defaultProject.id };
      if (!data.projects[saved.projectId]) throw new Error('project not found');
      data.cases[saved.id] = saved;
      save(data);
      return saved;
    },
    getCase(id) { return load().cases[id]; },
    listCases(query = '', projectId = '') {
      const normalized = query.trim().toLowerCase();
      return Object.values(load().cases).filter((testCase) => (!normalized || testCase.name.toLowerCase().includes(normalized)) && (!projectId || testCase.projectId === projectId));
    },
    listProjects() {
      const data = load();
      return Object.values(data.projects).map((project) => {
        const cases = Object.values(data.cases).filter((testCase) => testCase.projectId === project.id);
        return { ...project, caseCount: cases.length, webCaseCount: cases.filter((testCase) => testCase.target === 'web').length, apiCaseCount: cases.filter((testCase) => testCase.target === 'api').length };
      });
    },
    getProject(id) { return this.listProjects().find((project) => project.id === id); },
    saveProject(project) {
      const data = load();
      const name = project?.name?.trim();
      if (!name) throw new Error('project name required');
      if (Object.values(data.projects).some((item) => item.id !== project.id && item.name.toLowerCase() === name.toLowerCase())) throw new Error('project name already exists');
      const timestamp = new Date().toISOString();
      const saved = { id: project.id || crypto.randomUUID(), name, createdAt: project.createdAt || timestamp, updatedAt: timestamp };
      if (project.id && !data.projects[project.id]) throw new Error('project not found');
      data.projects[saved.id] = saved;
      save(data);
      return this.getProject(saved.id);
    },
    deleteProject(id) {
      const data = load();
      if (!data.projects[id] || Object.values(data.cases).some((testCase) => testCase.projectId === id)) return false;
      delete data.projects[id];
      save(data);
      return true;
    },
    saveRun(run) { const data = load(); data.runs[run.id] = run; save(data); return run; },
    getRun(id) { return load().runs[id]; },
    saveBatch(batch) {
      const data = load();
      const defaultProject = Object.values(data.projects).find((project) => project.name === '默认项目');
      const saved = { ...batch, projectId: batch.projectId || defaultProject.id };
      data.batches[saved.id] = saved;
      save(data);
      return saved;
    },
    getBatch(id) { return load().batches[id]; },
    listBatches(projectId = '') { return Object.values(load().batches).filter((batch) => !projectId || batch.projectId === projectId); }
  };
}
