import { DatabaseSync } from 'node:sqlite';

const schema = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS test_cases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    target TEXT NOT NULL,
    base_url TEXT NOT NULL,
    viewport TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS test_steps (
    id TEXT NOT NULL,
    case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL,
    instruction TEXT NOT NULL,
    PRIMARY KEY (case_id, id),
    UNIQUE (case_id, position)
  );
`;

export function createSqliteStore({ databasePath }) {
  const db = new DatabaseSync(databasePath);
  db.exec(schema);

  function inTransaction(work) {
    db.exec('BEGIN');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const selectCase = db.prepare(`
    SELECT id, name, target, base_url AS baseUrl, viewport
    FROM test_cases
    WHERE id = ?
  `);
  const selectSteps = db.prepare(`
    SELECT id, kind, instruction
    FROM test_steps
    WHERE case_id = ?
    ORDER BY position
  `);

  function hydrateCase(row) {
    if (!row) return undefined;
    return { ...row, steps: selectSteps.all(row.id) };
  }

  function writeCase(testCase) {
    const saved = { ...testCase, id: testCase.id || crypto.randomUUID() };
    const timestamp = new Date().toISOString();
    db.prepare(`
      INSERT INTO test_cases (id, name, target, base_url, viewport, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        target = excluded.target,
        base_url = excluded.base_url,
        viewport = excluded.viewport,
        updated_at = excluded.updated_at
    `).run(saved.id, saved.name, saved.target, saved.baseUrl, saved.viewport, timestamp, timestamp);
    db.prepare('DELETE FROM test_steps WHERE case_id = ?').run(saved.id);
    const insertStep = db.prepare(`
      INSERT INTO test_steps (id, case_id, position, kind, instruction)
      VALUES (?, ?, ?, ?, ?)
    `);
    saved.steps.forEach((step, position) => insertStep.run(step.id, saved.id, position, step.kind, step.instruction));
    return saved;
  }

  const saveCase = (testCase) => inTransaction(() => writeCase(testCase));

  return {
    saveCase,
    getCase(id) { return hydrateCase(selectCase.get(id)); },
    listCases() {
      return db.prepare(`
        SELECT id, name, target, base_url AS baseUrl, viewport
        FROM test_cases
        ORDER BY created_at, id
      `).all().map(hydrateCase);
    }
  };
}
