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
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_batches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS batch_cases (
      batch_id TEXT NOT NULL REFERENCES test_batches(id) ON DELETE CASCADE,
      case_id TEXT NOT NULL REFERENCES test_cases(id),
      position INTEGER NOT NULL,
      PRIMARY KEY (batch_id, case_id),
      UNIQUE (batch_id, position)
    );
    CREATE TABLE IF NOT EXISTS test_runs (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES test_cases(id),
      batch_id TEXT REFERENCES test_batches(id),
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      variables_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS run_steps (
      run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
      step_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      error TEXT,
      screenshot TEXT,
      logs_json TEXT NOT NULL,
      PRIMARY KEY (run_id, step_id),
      UNIQUE (run_id, position)
    );
  `);

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

  function hydrateRun(row) {
    if (!row) return undefined;
    const steps = db.prepare(`
      SELECT step_id AS id, status, attempts, error, screenshot, logs_json
      FROM run_steps
      WHERE run_id = ?
      ORDER BY position
    `).all(row.id).map(({ logs_json, ...step }) => ({ ...step, logs: JSON.parse(logs_json) }));
    return {
      id: row.id,
      caseId: row.caseId,
      status: row.status,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      variables: JSON.parse(row.variablesJson),
      steps
    };
  }

  function writeRun(run) {
    db.prepare(`
      INSERT INTO test_runs (id, case_id, batch_id, status, started_at, finished_at, variables_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        case_id = excluded.case_id,
        batch_id = COALESCE(excluded.batch_id, test_runs.batch_id),
        status = excluded.status,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        variables_json = excluded.variables_json
    `).run(run.id, run.caseId, run.batchId || null, run.status, run.startedAt, run.finishedAt, JSON.stringify(run.variables || {}));
    db.prepare('DELETE FROM run_steps WHERE run_id = ?').run(run.id);
    const insertStep = db.prepare(`
      INSERT INTO run_steps (run_id, step_id, position, status, attempts, error, screenshot, logs_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    run.steps.forEach((step, position) => {
      insertStep.run(run.id, step.id, position, step.status, step.attempts, step.error || null, step.screenshot || null, JSON.stringify(step.logs || []));
    });
    return run;
  }

  function hydrateBatch(row) {
    if (!row) return undefined;
    const caseIds = db.prepare(`
      SELECT case_id AS id
      FROM batch_cases
      WHERE batch_id = ?
      ORDER BY position
    `).all(row.id).map(({ id }) => id);
    const runIds = db.prepare(`
      SELECT id
      FROM test_runs
      WHERE batch_id = ?
      ORDER BY started_at, id
    `).all(row.id).map(({ id }) => id);
    return {
      id: row.id,
      name: row.name,
      caseIds,
      status: row.status,
      runIds,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt
    };
  }

  function writeBatch(batch) {
    db.prepare(`
      INSERT INTO test_batches (id, name, status, started_at, finished_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        status = excluded.status,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at
    `).run(batch.id, batch.name, batch.status, batch.startedAt, batch.finishedAt, batch.startedAt || new Date().toISOString());
    db.prepare('DELETE FROM batch_cases WHERE batch_id = ?').run(batch.id);
    const insertCase = db.prepare('INSERT INTO batch_cases (batch_id, case_id, position) VALUES (?, ?, ?)');
    batch.caseIds.forEach((caseId, position) => insertCase.run(batch.id, caseId, position));
    const linkRun = db.prepare('UPDATE test_runs SET batch_id = ? WHERE id = ?');
    batch.runIds.forEach((runId) => linkRun.run(batch.id, runId));
    return batch;
  }

  const saveRun = (run) => inTransaction(() => writeRun(run));
  const saveBatch = (batch) => inTransaction(() => writeBatch(batch));

  return {
    saveCase,
    getCase(id) { return hydrateCase(selectCase.get(id)); },
    listCases() {
      return db.prepare(`
        SELECT id, name, target, base_url AS baseUrl, viewport
        FROM test_cases
        ORDER BY created_at, id
      `).all().map(hydrateCase);
    },
    saveRun,
    getRun(id) {
      return hydrateRun(db.prepare(`
        SELECT id, case_id AS caseId, status, started_at AS startedAt,
          finished_at AS finishedAt, variables_json AS variablesJson
        FROM test_runs
        WHERE id = ?
      `).get(id));
    },
    saveBatch,
    getBatch(id) {
      return hydrateBatch(db.prepare(`
        SELECT id, name, status, started_at AS startedAt, finished_at AS finishedAt
        FROM test_batches
        WHERE id = ?
      `).get(id));
    },
    listBatches() {
      return db.prepare(`
        SELECT id, name, status, started_at AS startedAt, finished_at AS finishedAt
        FROM test_batches
        ORDER BY created_at, id
      `).all().map(hydrateBatch);
    }
  };
}
