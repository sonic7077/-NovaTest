import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, renameSync } from 'node:fs';

const schema = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS test_cases (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
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

export function createSqliteStore({ databasePath, legacyJsonPath }) {
  const db = new DatabaseSync(databasePath);
  db.exec(schema);
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_batches (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
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
      batch_position INTEGER,
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
      try { db.exec('ROLLBACK'); } catch { /* The transaction may have already ended. */ }
      throw error;
    }
  }

  function defaultProject() {
    const project = db.prepare('SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE name = ?').get('默认项目');
    if (project) return project;
    const timestamp = new Date().toISOString();
    const created = { id: crypto.randomUUID(), name: '默认项目', createdAt: timestamp, updatedAt: timestamp };
    db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(created.id, created.name, created.createdAt, created.updatedAt);
    return created;
  }

  function migrateProjectSchema() {
    const columns = db.prepare('PRAGMA table_info(test_cases)').all().map((column) => column.name);
    if (!columns.includes('project_id')) db.exec('ALTER TABLE test_cases ADD COLUMN project_id TEXT REFERENCES projects(id)');
    const project = defaultProject();
    db.prepare("UPDATE test_cases SET project_id = ? WHERE project_id IS NULL OR TRIM(project_id) = ''").run(project.id);
    db.exec('CREATE INDEX IF NOT EXISTS test_cases_project_id_idx ON test_cases(project_id)');
    if (db.prepare('PRAGMA user_version').get().user_version < 7) db.exec('PRAGMA user_version = 7');
  }

  function migrateHistorySchema() {
    if (db.prepare('PRAGMA user_version').get().user_version >= 2) return;
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      inTransaction(() => {
        db.exec(`
          CREATE TABLE test_runs_next (
            id TEXT PRIMARY KEY, case_id TEXT NOT NULL, case_name TEXT NOT NULL,
            batch_id TEXT REFERENCES test_batches(id), batch_position INTEGER,
            status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
            variables_json TEXT NOT NULL
          );
          INSERT INTO test_runs_next (id, case_id, case_name, batch_id, batch_position, status, started_at, finished_at, variables_json)
          SELECT runs.id, runs.case_id, COALESCE(cases.name, '已删除用例'), runs.batch_id, runs.batch_position, runs.status, runs.started_at, runs.finished_at, runs.variables_json
          FROM test_runs AS runs LEFT JOIN test_cases AS cases ON cases.id = runs.case_id;
          CREATE TABLE batch_cases_next (
            batch_id TEXT NOT NULL REFERENCES test_batches(id) ON DELETE CASCADE,
            case_id TEXT NOT NULL, position INTEGER NOT NULL,
            PRIMARY KEY (batch_id, case_id), UNIQUE (batch_id, position)
          );
          INSERT INTO batch_cases_next (batch_id, case_id, position) SELECT batch_id, case_id, position FROM batch_cases;
          CREATE TABLE run_steps_next (
            run_id TEXT NOT NULL REFERENCES test_runs_next(id) ON DELETE CASCADE,
            step_id TEXT NOT NULL, position INTEGER NOT NULL, status TEXT NOT NULL,
            attempts INTEGER NOT NULL, error TEXT, screenshot TEXT, logs_json TEXT NOT NULL,
            PRIMARY KEY (run_id, step_id), UNIQUE (run_id, position)
          );
          INSERT INTO run_steps_next (run_id, step_id, position, status, attempts, error, screenshot, logs_json)
          SELECT run_id, step_id, position, status, attempts, error, screenshot, logs_json FROM run_steps;
          DROP TABLE run_steps; DROP TABLE test_runs; DROP TABLE batch_cases;
          ALTER TABLE test_runs_next RENAME TO test_runs;
          ALTER TABLE batch_cases_next RENAME TO batch_cases;
          ALTER TABLE run_steps_next RENAME TO run_steps;
          PRAGMA user_version = 2;
        `);
      });
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  migrateHistorySchema();

  function migrateEvidenceSchema() {
    const columns = db.prepare('PRAGMA table_info(run_steps)').all().map((column) => column.name);
    if (!columns.includes('screenshots_json')) db.exec("ALTER TABLE run_steps ADD COLUMN screenshots_json TEXT NOT NULL DEFAULT '[]'");
    if (db.prepare('PRAGMA user_version').get().user_version < 3) db.exec('PRAGMA user_version = 3');
  }

  migrateEvidenceSchema();

  function migrateVisualCheckSchema() {
    const columns = db.prepare('PRAGMA table_info(test_steps)').all().map((column) => column.name);
    if (!columns.includes('visual_checks_json')) db.exec("ALTER TABLE test_steps ADD COLUMN visual_checks_json TEXT NOT NULL DEFAULT '[]'");
    if (db.prepare('PRAGMA user_version').get().user_version < 4) db.exec('PRAGMA user_version = 4');
  }

  migrateVisualCheckSchema();

  function migrateApiRequestSchema() {
    const columns = db.prepare('PRAGMA table_info(test_steps)').all().map((column) => column.name);
    if (!columns.includes('request_json')) db.exec("ALTER TABLE test_steps ADD COLUMN request_json TEXT NOT NULL DEFAULT 'null'");
    if (db.prepare('PRAGMA user_version').get().user_version < 5) db.exec('PRAGMA user_version = 5');
  }

  migrateApiRequestSchema();

  function migrateApiEvidenceSchema() {
    const columns = db.prepare('PRAGMA table_info(run_steps)').all().map((column) => column.name);
    if (!columns.includes('api_json')) db.exec("ALTER TABLE run_steps ADD COLUMN api_json TEXT NOT NULL DEFAULT 'null'");
    if (db.prepare('PRAGMA user_version').get().user_version < 6) db.exec('PRAGMA user_version = 6');
  }

  migrateApiEvidenceSchema();
  migrateProjectSchema();

  function migrateBatchProjectSchema() {
    const columns = db.prepare('PRAGMA table_info(test_batches)').all().map((column) => column.name);
    if (!columns.includes('project_id')) db.exec('ALTER TABLE test_batches ADD COLUMN project_id TEXT REFERENCES projects(id)');
    db.prepare("UPDATE test_batches SET project_id = ? WHERE project_id IS NULL OR TRIM(project_id) = ''").run(defaultProject().id);
    db.exec('CREATE INDEX IF NOT EXISTS test_batches_project_id_idx ON test_batches(project_id)');
    if (db.prepare('PRAGMA user_version').get().user_version < 8) db.exec('PRAGMA user_version = 8');
  }

  migrateBatchProjectSchema();

  function migrateExecutionSnapshotSchema() {
    const runColumns = db.prepare('PRAGMA table_info(test_runs)').all();
    const batchColumns = db.prepare('PRAGMA table_info(test_batches)').all().map((column) => column.name);
    const startedAt = runColumns.find((column) => column.name === 'started_at');
    const needsRebuild = !runColumns.some((column) => column.name === 'project_id')
      || !runColumns.some((column) => column.name === 'target')
      || startedAt?.notnull === 1;

    if (needsRebuild) {
      db.exec('PRAGMA foreign_keys = OFF');
      try {
        inTransaction(() => {
          db.exec(`
            CREATE TABLE test_runs_next (
              id TEXT PRIMARY KEY, case_id TEXT NOT NULL, case_name TEXT NOT NULL,
              batch_id TEXT REFERENCES test_batches(id), batch_position INTEGER,
              project_id TEXT, target TEXT, status TEXT NOT NULL, started_at TEXT,
              finished_at TEXT, variables_json TEXT NOT NULL
            );
            INSERT INTO test_runs_next (id, case_id, case_name, batch_id, batch_position, project_id, target, status, started_at, finished_at, variables_json)
            SELECT runs.id, runs.case_id, runs.case_name, runs.batch_id, runs.batch_position,
              cases.project_id, cases.target, runs.status, runs.started_at, runs.finished_at, runs.variables_json
            FROM test_runs AS runs LEFT JOIN test_cases AS cases ON cases.id = runs.case_id;
            CREATE TABLE run_steps_next (
              run_id TEXT NOT NULL REFERENCES test_runs_next(id) ON DELETE CASCADE,
              step_id TEXT NOT NULL, position INTEGER NOT NULL, status TEXT NOT NULL,
              attempts INTEGER NOT NULL, error TEXT, screenshot TEXT, logs_json TEXT NOT NULL,
              screenshots_json TEXT NOT NULL DEFAULT '[]', api_json TEXT NOT NULL DEFAULT 'null',
              PRIMARY KEY (run_id, step_id), UNIQUE (run_id, position)
            );
            INSERT INTO run_steps_next (run_id, step_id, position, status, attempts, error, screenshot, logs_json, screenshots_json, api_json)
            SELECT run_id, step_id, position, status, attempts, error, screenshot, logs_json, screenshots_json, api_json FROM run_steps;
            DROP TABLE run_steps; DROP TABLE test_runs;
            ALTER TABLE test_runs_next RENAME TO test_runs;
            ALTER TABLE run_steps_next RENAME TO run_steps;
          `);
        });
      } finally {
        db.exec('PRAGMA foreign_keys = ON');
      }
    }
    if (!batchColumns.includes('target')) db.exec('ALTER TABLE test_batches ADD COLUMN target TEXT');
    db.exec('UPDATE test_runs SET project_id = (SELECT project_id FROM test_cases WHERE test_cases.id = test_runs.case_id) WHERE project_id IS NULL');
    db.exec('UPDATE test_runs SET target = (SELECT target FROM test_cases WHERE test_cases.id = test_runs.case_id) WHERE target IS NULL');
    db.exec("UPDATE test_batches SET target = (SELECT target FROM test_runs WHERE test_runs.batch_id = test_batches.id AND target IS NOT NULL ORDER BY batch_position LIMIT 1) WHERE target IS NULL");
    db.exec('CREATE INDEX IF NOT EXISTS test_runs_dashboard_idx ON test_runs(finished_at, project_id, target, status)');
    if (db.prepare('PRAGMA user_version').get().user_version < 9) db.exec('PRAGMA user_version = 9');
  }

  migrateExecutionSnapshotSchema();

  const selectCase = db.prepare(`
    SELECT id, project_id AS projectId, name, target, base_url AS baseUrl, viewport
    FROM test_cases
    WHERE id = ?
  `);
  const selectSteps = db.prepare(`
    SELECT id, kind, instruction, visual_checks_json, request_json
    FROM test_steps
    WHERE case_id = ?
    ORDER BY position
  `);

  function hydrateCase(row) {
    if (!row) return undefined;
    return { ...row, steps: selectSteps.all(row.id).map(({ visual_checks_json, request_json, ...step }) => ({ ...step, visualChecks: JSON.parse(visual_checks_json || '[]'), request: JSON.parse(request_json || 'null') || undefined })) };
  }

  function writeCase(testCase) {
    const projectId = testCase.projectId || defaultProject().id;
    if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) throw new Error('project not found');
    const saved = { ...testCase, id: testCase.id || crypto.randomUUID(), projectId };
    const timestamp = new Date().toISOString();
    db.prepare(`
      INSERT INTO test_cases (id, project_id, name, target, base_url, viewport, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        name = excluded.name,
        target = excluded.target,
        base_url = excluded.base_url,
        viewport = excluded.viewport,
        updated_at = excluded.updated_at
    `).run(saved.id, saved.projectId, saved.name, saved.target, saved.baseUrl, saved.viewport, timestamp, timestamp);
    db.prepare('DELETE FROM test_steps WHERE case_id = ?').run(saved.id);
    const insertStep = db.prepare(`
      INSERT INTO test_steps (id, case_id, position, kind, instruction, visual_checks_json, request_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    saved.steps.forEach((step, position) => insertStep.run(step.id, saved.id, position, step.kind, step.instruction, JSON.stringify(step.visualChecks || []), JSON.stringify(step.request || null)));
    return saved;
  }

  const saveCase = (testCase) => inTransaction(() => writeCase(testCase));

  function hydrateRun(row) {
    if (!row) return undefined;
    const steps = db.prepare(`
      SELECT step_id AS id, status, attempts, error, screenshot, logs_json, screenshots_json, api_json
      FROM run_steps
      WHERE run_id = ?
      ORDER BY position
    `).all(row.id).map(({ logs_json, screenshots_json, api_json, ...step }) => ({ ...step, logs: JSON.parse(logs_json), screenshots: JSON.parse(screenshots_json || '[]'), api: JSON.parse(api_json || 'null') || undefined }));
    return {
      id: row.id,
      caseId: row.caseId,
      caseName: row.caseName,
      projectId: row.projectId,
      target: row.target,
      status: row.status,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      variables: JSON.parse(row.variablesJson),
      steps
    };
  }

  function writeRun(run) {
    const currentCase = hydrateCase(selectCase.get(run.caseId));
    const projectId = run.projectId || currentCase?.projectId || defaultProject().id;
    const target = run.target || currentCase?.target || null;
    db.prepare(`
      INSERT INTO test_runs (id, case_id, case_name, batch_id, batch_position, project_id, target, status, started_at, finished_at, variables_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        case_id = excluded.case_id,
        case_name = excluded.case_name,
        batch_id = COALESCE(excluded.batch_id, test_runs.batch_id),
        batch_position = COALESCE(excluded.batch_position, test_runs.batch_position),
        project_id = excluded.project_id,
        target = excluded.target,
        status = excluded.status,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        variables_json = excluded.variables_json
    `).run(run.id, run.caseId, run.caseName || currentCase?.name || '已删除用例', run.batchId || null, run.batchPosition ?? null, projectId, target, run.status, run.startedAt, run.finishedAt, JSON.stringify(run.variables || {}));
    db.prepare('DELETE FROM run_steps WHERE run_id = ?').run(run.id);
    const insertStep = db.prepare(`
      INSERT INTO run_steps (run_id, step_id, position, status, attempts, error, screenshot, logs_json, screenshots_json, api_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    run.steps.forEach((step, position) => {
      insertStep.run(run.id, step.id, position, step.status, step.attempts, step.error || null, step.screenshot || null, JSON.stringify(step.logs || []), JSON.stringify(step.screenshots || []), JSON.stringify(step.api || null));
    });
    return { ...run, projectId, target };
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
      ORDER BY batch_position, started_at, id
    `).all(row.id).map(({ id }) => id);
    return {
      id: row.id,
      projectId: row.projectId,
      target: row.target,
      name: row.name,
      caseIds,
      status: row.status,
      runIds,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt
    };
  }

  function writeBatch(batch) {
    const projectId = batch.projectId || defaultProject().id;
    if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) throw new Error('project not found');
    db.prepare(`
      INSERT INTO test_batches (id, project_id, target, name, status, started_at, finished_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        target = excluded.target,
        name = excluded.name,
        status = excluded.status,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at
    `).run(batch.id, projectId, batch.target || null, batch.name, batch.status, batch.startedAt, batch.finishedAt, batch.startedAt || new Date().toISOString());
    db.prepare('DELETE FROM batch_cases WHERE batch_id = ?').run(batch.id);
    const insertCase = db.prepare('INSERT INTO batch_cases (batch_id, case_id, position) VALUES (?, ?, ?)');
    batch.caseIds.forEach((caseId, position) => insertCase.run(batch.id, caseId, position));
    db.prepare('UPDATE test_runs SET batch_id = NULL, batch_position = NULL WHERE batch_id = ?').run(batch.id);
    const linkRun = db.prepare('UPDATE test_runs SET batch_id = ?, batch_position = ? WHERE id = ?');
    batch.runIds.forEach((runId, position) => linkRun.run(batch.id, position, runId));
    return { ...batch, projectId, target: batch.target || null };
  }

  const saveRun = (run) => inTransaction(() => writeRun(run));
  const saveBatch = (batch) => inTransaction(() => writeBatch(batch));
  const deleteCase = (id) => inTransaction(() => db.prepare('DELETE FROM test_cases WHERE id = ?').run(id).changes > 0);

  function migrateLegacyStore() {
    if (!legacyJsonPath || !existsSync(legacyJsonPath)) return;
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM test_cases').get();
    if (count > 0) return;

    const legacy = JSON.parse(readFileSync(legacyJsonPath, 'utf8'));
    const backupPath = `${legacyJsonPath}.migrated`;
    let renamed = false;

    try {
      inTransaction(() => {
        const caseIds = new Set();
        Object.entries(legacy.cases || {}).forEach(([key, testCase]) => {
          const id = testCase.id || (key === 'undefined' ? crypto.randomUUID() : key);
          writeCase({ ...testCase, id });
          caseIds.add(id);
        });

        const runIds = new Set();
        Object.entries(legacy.runs || {}).forEach(([key, run]) => {
          if (!run.caseId || !caseIds.has(run.caseId)) return;
          const id = run.id || key;
          writeRun({ ...run, id });
          runIds.add(id);
        });

        Object.entries(legacy.batches || {}).forEach(([key, batch]) => {
          const id = batch.id || key;
          const caseIdsInBatch = (batch.caseIds || []).filter((caseId) => caseIds.has(caseId));
          writeBatch({ ...batch, id, caseIds: caseIdsInBatch, runIds: (batch.runIds || []).filter((runId) => runIds.has(runId)) });
        });

        if (!existsSync(backupPath)) {
          renameSync(legacyJsonPath, backupPath);
          renamed = true;
        }
      });
    } catch (error) {
      if (renamed && !existsSync(legacyJsonPath)) renameSync(backupPath, legacyJsonPath);
      throw error;
    }
  }

  migrateLegacyStore();

  function listProjects() {
    return db.prepare(`
      SELECT projects.id, projects.name, projects.created_at AS createdAt, projects.updated_at AS updatedAt,
        SUM(CASE WHEN test_cases.target = 'web' THEN 1 ELSE 0 END) AS webCaseCount,
        SUM(CASE WHEN test_cases.target = 'api' THEN 1 ELSE 0 END) AS apiCaseCount,
        COUNT(test_cases.id) AS caseCount
      FROM projects
      LEFT JOIN test_cases ON test_cases.project_id = projects.id
      GROUP BY projects.id
      ORDER BY projects.created_at, projects.id
    `).all().map((project) => ({ ...project, webCaseCount: Number(project.webCaseCount), apiCaseCount: Number(project.apiCaseCount), caseCount: Number(project.caseCount) }));
  }

  function getProject(id) {
    return listProjects().find((project) => project.id === id);
  }

  function saveProject(project) {
    const name = project?.name?.trim();
    if (!name) throw new Error('project name required');
    const timestamp = new Date().toISOString();
    const id = project.id || crypto.randomUUID();
    try {
      if (project.id) {
        const result = db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, timestamp, id);
        if (result.changes === 0) throw new Error('project not found');
      } else {
        db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, timestamp, timestamp);
      }
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) throw new Error('project name already exists');
      throw error;
    }
    return getProject(id);
  }

  function deleteProject(id) {
    if (db.prepare('SELECT 1 FROM test_cases WHERE project_id = ? LIMIT 1').get(id)) return false;
    return db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
  }

  function executionFilters({ projectId = '', target = '', status = '' } = {}, column) {
    const clauses = [];
    const parameters = [];
    if (projectId) { clauses.push(`${column}.project_id = ?`); parameters.push(projectId); }
    if (target) { clauses.push(`${column}.target = ?`); parameters.push(target); }
    if (status) { clauses.push(`${column}.status = ?`); parameters.push(status); }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', parameters };
  }

  function listExecutions(filters = {}) {
    const batchFilters = executionFilters(filters, 'b');
    const runFilters = executionFilters(filters, 'r');
    const batches = db.prepare(`
      SELECT b.id, b.project_id AS projectId, p.name AS projectName, b.target, b.name, b.status,
        b.started_at AS startedAt, b.finished_at AS finishedAt,
        (SELECT COUNT(*) FROM batch_cases WHERE batch_id = b.id) AS totalCases,
        (SELECT COUNT(*) FROM test_runs WHERE batch_id = b.id AND status IN ('passed', 'failed')) AS completedCases,
        (SELECT COUNT(*) FROM run_steps JOIN test_runs ON test_runs.id = run_steps.run_id WHERE test_runs.batch_id = b.id) AS totalSteps,
        (SELECT COUNT(*) FROM run_steps JOIN test_runs ON test_runs.id = run_steps.run_id WHERE test_runs.batch_id = b.id AND run_steps.status IN ('passed', 'failed')) AS completedSteps,
        (SELECT case_name FROM test_runs WHERE batch_id = b.id AND status IN ('queued', 'running') ORDER BY batch_position, id LIMIT 1) AS currentCaseName
      FROM test_batches AS b
      LEFT JOIN projects AS p ON p.id = b.project_id
      ${batchFilters.where}
    `).all(...batchFilters.parameters).map((row) => ({ ...row, kind: 'batch', totalCases: Number(row.totalCases), completedCases: Number(row.completedCases), totalSteps: Number(row.totalSteps), completedSteps: Number(row.completedSteps) }));
    const runs = db.prepare(`
      SELECT r.id, r.project_id AS projectId, p.name AS projectName, r.target, r.case_name AS name, r.status,
        r.started_at AS startedAt, r.finished_at AS finishedAt,
        1 AS totalCases, CASE WHEN r.status IN ('passed', 'failed') THEN 1 ELSE 0 END AS completedCases,
        (SELECT COUNT(*) FROM run_steps WHERE run_id = r.id) AS totalSteps,
        (SELECT COUNT(*) FROM run_steps WHERE run_id = r.id AND status IN ('passed', 'failed')) AS completedSteps,
        r.case_name AS currentCaseName
      FROM test_runs AS r
      LEFT JOIN projects AS p ON p.id = r.project_id
      ${runFilters.where ? `${runFilters.where} AND r.batch_id IS NULL` : 'WHERE r.batch_id IS NULL'}
    `).all(...runFilters.parameters).map((row) => ({ ...row, kind: 'run', totalCases: Number(row.totalCases), completedCases: Number(row.completedCases), totalSteps: Number(row.totalSteps), completedSteps: Number(row.completedSteps) }));
    return [...batches, ...runs].sort((first, second) => String(second.finishedAt || second.startedAt || '').localeCompare(String(first.finishedAt || first.startedAt || '')));
  }

  function rangeStart(range, now) {
    const date = new Date(now || Date.now());
    if (range === 'today') {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
      const read = (type) => Number(parts.find((part) => part.type === type).value);
      return new Date(Date.UTC(read('year'), read('month') - 1, read('day')) - 8 * 60 * 60 * 1000).toISOString();
    }
    const days = range === '30d' ? 30 : 7;
    return new Date(date.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  function listReports({ projectId = '', target = '', status = '', range = '7d', now } = {}) {
    const start = rangeStart(range, now);
    const batchFilters = executionFilters({ projectId, target, status }, 'b');
    const runFilters = executionFilters({ projectId, target, status }, 'r');
    const terminal = "status IN ('passed', 'failed')";
    const batchWhere = [terminal.replaceAll('status', 'b.status'), 'b.finished_at >= ?', batchFilters.where.replace(/^WHERE /, '')].filter(Boolean).join(' AND ');
    const runWhere = [terminal.replaceAll('status', 'r.status'), 'r.finished_at >= ?', 'r.batch_id IS NULL', runFilters.where.replace(/^WHERE /, '')].filter(Boolean).join(' AND ');
    const batches = db.prepare(`
      SELECT b.id, b.name, b.project_id AS projectId, p.name AS projectName, b.target, b.status,
        b.started_at AS startedAt, b.finished_at AS finishedAt,
        (SELECT COUNT(*) FROM test_runs WHERE batch_id = b.id AND status = 'passed') AS passedCases,
        (SELECT COUNT(*) FROM test_runs WHERE batch_id = b.id AND status = 'failed') AS failedCases
      FROM test_batches AS b LEFT JOIN projects AS p ON p.id = b.project_id
      WHERE ${batchWhere}
    `).all(start, ...batchFilters.parameters).map((row) => ({ ...row, kind: 'batch', reportUrl: `/api/batches/${encodeURIComponent(row.id)}/report`, passedCases: Number(row.passedCases), failedCases: Number(row.failedCases) }));
    const runs = db.prepare(`
      SELECT r.id, r.case_name AS name, r.project_id AS projectId, p.name AS projectName, r.target, r.status,
        r.started_at AS startedAt, r.finished_at AS finishedAt,
        CASE WHEN r.status = 'passed' THEN 1 ELSE 0 END AS passedCases,
        CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END AS failedCases
      FROM test_runs AS r LEFT JOIN projects AS p ON p.id = r.project_id
      WHERE ${runWhere}
    `).all(start, ...runFilters.parameters).map((row) => ({ ...row, kind: 'run', reportUrl: `/api/runs/${encodeURIComponent(row.id)}/report`, passedCases: Number(row.passedCases), failedCases: Number(row.failedCases) }));
    return [...batches, ...runs].sort((first, second) => String(second.finishedAt).localeCompare(String(first.finishedAt)));
  }

  function getDashboard({ range = '7d', now } = {}) {
    const start = rangeStart(range, now);
    const summary = db.prepare(`
      SELECT COUNT(*) AS completedRuns,
        SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) AS passedRuns,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedRuns,
        AVG((julianday(finished_at) - julianday(started_at)) * 86400000) AS averageDurationMs
      FROM test_runs
      WHERE status IN ('passed', 'failed') AND finished_at >= ?
    `).get(start);
    const completedRuns = Number(summary.completedRuns);
    const daily = db.prepare(`
      SELECT strftime('%Y-%m-%d', datetime(finished_at, '+8 hours')) AS date,
        SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) AS passed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM test_runs
      WHERE status IN ('passed', 'failed') AND finished_at >= ?
      GROUP BY date ORDER BY date
    `).all(start).map((row) => ({ ...row, passed: Number(row.passed), failed: Number(row.failed) }));
    const targets = db.prepare(`
      SELECT target, COUNT(*) AS completedRuns,
        SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) AS passedRuns,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedRuns
      FROM test_runs
      WHERE status IN ('passed', 'failed') AND finished_at >= ? AND target IS NOT NULL
      GROUP BY target ORDER BY target
    `).all(start).map((row) => ({ ...row, completedRuns: Number(row.completedRuns), passedRuns: Number(row.passedRuns), failedRuns: Number(row.failedRuns) }));
    const recentFailures = db.prepare(`
      SELECT runs.id AS runId, runs.case_name AS caseName, runs.target, runs.finished_at AS finishedAt,
        projects.name AS projectName, run_steps.error
      FROM run_steps JOIN test_runs AS runs ON runs.id = run_steps.run_id
      LEFT JOIN projects ON projects.id = runs.project_id
      WHERE runs.status = 'failed' AND runs.finished_at >= ? AND run_steps.status = 'failed'
      ORDER BY runs.finished_at DESC LIMIT 8
    `).all(start);
    return {
      completedRuns,
      passedRuns: Number(summary.passedRuns || 0),
      failedRuns: Number(summary.failedRuns || 0),
      passRate: completedRuns ? Number(((Number(summary.passedRuns || 0) / completedRuns) * 100).toFixed(1)) : 0,
      averageDurationMs: Math.round(Number(summary.averageDurationMs || 0)),
      automatedCaseCount: Number(db.prepare('SELECT COUNT(*) AS count FROM test_cases').get().count),
      daily,
      targets,
      recentFailures,
      recentReports: listReports({ range, now }).slice(0, 8)
    };
  }

  function failInterruptedExecutions(message) {
    const timestamp = new Date().toISOString();
    return inTransaction(() => {
      db.prepare("UPDATE run_steps SET status = 'failed', error = COALESCE(error, ?) WHERE status IN ('queued', 'running')").run(message);
      const runs = db.prepare("UPDATE test_runs SET status = 'failed', finished_at = ? WHERE status IN ('queued', 'running')").run(timestamp).changes;
      const batches = db.prepare("UPDATE test_batches SET status = 'failed', finished_at = ? WHERE status IN ('queued', 'running')").run(timestamp).changes;
      return runs + batches;
    });
  }

  return {
    saveCase,
    getCase(id) { return hydrateCase(selectCase.get(id)); },
    listCases(query = '', projectId = '') {
      const normalized = query.trim();
      const conditions = [];
      const parameters = [];
      if (normalized) { conditions.push('LOWER(name) LIKE LOWER(?)'); parameters.push(`%${normalized}%`); }
      if (projectId) { conditions.push('project_id = ?'); parameters.push(projectId); }
      const statement = db.prepare(`
        SELECT id, project_id AS projectId, name, target, base_url AS baseUrl, viewport
        FROM test_cases
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY created_at, id
      `);
      return statement.all(...parameters).map(hydrateCase);
    },
    listProjects,
    getProject,
    saveProject,
    deleteProject,
    saveRun,
    getRun(id) {
      return hydrateRun(db.prepare(`
        SELECT id, case_id AS caseId, case_name AS caseName, project_id AS projectId, target, status, started_at AS startedAt,
          finished_at AS finishedAt, variables_json AS variablesJson
        FROM test_runs
        WHERE id = ?
      `).get(id));
    },
    deleteCase,
    saveBatch,
    getBatch(id) {
      return hydrateBatch(db.prepare(`
        SELECT id, project_id AS projectId, target, name, status, started_at AS startedAt, finished_at AS finishedAt
        FROM test_batches
        WHERE id = ?
      `).get(id));
    },
    listBatches(projectId = '') {
      return db.prepare(`
        SELECT id, project_id AS projectId, target, name, status, started_at AS startedAt, finished_at AS finishedAt
        FROM test_batches
        ${projectId ? 'WHERE project_id = ?' : ''}
        ORDER BY created_at, id
      `).all(...(projectId ? [projectId] : [])).map(hydrateBatch);
    },
    listExecutions,
    getDashboard,
    listReports,
    failInterruptedExecutions
  };
}
