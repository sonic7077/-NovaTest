import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function emptyData() {
  return { cases: {}, runs: {} };
}

export function createFileStore(filePath) {
  function load() {
    if (!existsSync(filePath)) return emptyData();
    const data = { ...emptyData(), ...JSON.parse(readFileSync(filePath, 'utf8')) };
    let changed = false;
    Object.entries(data.cases).forEach(([key, testCase]) => {
      if (testCase.id) return;
      const id = key === 'undefined' ? crypto.randomUUID() : key;
      data.cases[id] = { ...testCase, id };
      if (id !== key) delete data.cases[key];
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
      const saved = { ...testCase, id: testCase.id || crypto.randomUUID() };
      const data = load();
      data.cases[saved.id] = saved;
      save(data);
      return saved;
    },
    getCase(id) { return load().cases[id]; },
    listCases() { return Object.values(load().cases); },
    saveRun(run) { const data = load(); data.runs[run.id] = run; save(data); return run; },
    getRun(id) { return load().runs[id]; }
  };
}
