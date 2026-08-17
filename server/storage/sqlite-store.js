import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { normalizeProjectWebAuth } from '../domain/project-auth.js';
import { publicAccountPool, validateAccountPool } from '../domain/performance.js';
import { normalizeRuntimeConfig } from '../services/runtime-config-service.js';

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
  CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
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
      planned_case_count INTEGER NOT NULL DEFAULT 0,
      planned_step_count INTEGER NOT NULL DEFAULT 0,
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
    const project = db.prepare('SELECT id, name, web_auth_json AS webAuthJson, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE name = ?').get('默认项目');
    if (project) return hydrateProject(project);
    const timestamp = new Date().toISOString();
    const created = { id: crypto.randomUUID(), name: '默认项目', createdAt: timestamp, updatedAt: timestamp };
    db.prepare('INSERT INTO projects (id, name, web_auth_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(created.id, created.name, 'null', created.createdAt, created.updatedAt);
    return { ...created, webAuth: undefined };
  }

  function migrateProjectWebAuthSchema() {
    const columns = db.prepare('PRAGMA table_info(projects)').all().map((column) => column.name);
    if (!columns.includes('web_auth_json')) db.exec("ALTER TABLE projects ADD COLUMN web_auth_json TEXT NOT NULL DEFAULT 'null'");
    if (db.prepare('PRAGMA user_version').get().user_version < 12) db.exec('PRAGMA user_version = 12');
  }

  function hydrateProject(row) {
    if (!row) return undefined;
    const { webAuthJson, ...project } = row;
    return { ...project, webAuth: normalizeProjectWebAuth(JSON.parse(webAuthJson || 'null')) };
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
  migrateProjectWebAuthSchema();

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

  function migrateUserSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        display_name TEXT NOT NULL,
        job_title TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    if (db.prepare('PRAGMA user_version').get().user_version < 10) db.exec('PRAGMA user_version = 10');
  }

  migrateUserSchema();

  function migrateMutationAuthorizationSchema() {
    const runColumns = db.prepare('PRAGMA table_info(test_runs)').all().map((column) => column.name);
    const batchColumns = db.prepare('PRAGMA table_info(test_batches)').all().map((column) => column.name);
    if (!runColumns.includes('allow_mutations')) db.exec('ALTER TABLE test_runs ADD COLUMN allow_mutations INTEGER NOT NULL DEFAULT 0');
    if (!batchColumns.includes('allow_mutations')) db.exec('ALTER TABLE test_batches ADD COLUMN allow_mutations INTEGER NOT NULL DEFAULT 0');
    if (db.prepare('PRAGMA user_version').get().user_version < 11) db.exec('PRAGMA user_version = 11');
  }

  migrateMutationAuthorizationSchema();

  function migrateBatchPlanSchema() {
    const columns = db.prepare('PRAGMA table_info(test_batches)').all().map((column) => column.name);
    if (!columns.includes('planned_case_count')) db.exec('ALTER TABLE test_batches ADD COLUMN planned_case_count INTEGER NOT NULL DEFAULT 0');
    if (!columns.includes('planned_step_count')) db.exec('ALTER TABLE test_batches ADD COLUMN planned_step_count INTEGER NOT NULL DEFAULT 0');
    if (db.prepare('PRAGMA user_version').get().user_version < 14) db.exec('PRAGMA user_version = 14');
  }

  migrateBatchPlanSchema();

  function migrateRunVisualCheckSchema() {
    const columns = db.prepare('PRAGMA table_info(run_steps)').all().map((column) => column.name);
    if (!columns.includes('visual_checks_json')) db.exec("ALTER TABLE run_steps ADD COLUMN visual_checks_json TEXT NOT NULL DEFAULT '[]'");
    if (db.prepare('PRAGMA user_version').get().user_version < 13) db.exec('PRAGMA user_version = 13');
  }

  migrateRunVisualCheckSchema();

  function migratePerformanceSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS performance_account_pools (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        accounts_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS performance_assets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        protocol TEXT NOT NULL,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS performance_runs (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES performance_assets(id),
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        summary_json TEXT NOT NULL DEFAULT '{}',
        error TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS performance_run_samples (
        run_id TEXT NOT NULL REFERENCES performance_runs(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        sample_json TEXT NOT NULL,
        PRIMARY KEY (run_id, position)
      );
      CREATE INDEX IF NOT EXISTS performance_assets_project_idx ON performance_assets(project_id);
      CREATE INDEX IF NOT EXISTS performance_runs_project_idx ON performance_runs(project_id, finished_at);
    `);
    if (db.prepare('PRAGMA user_version').get().user_version < 15) db.exec('PRAGMA user_version = 15');
  }

  migratePerformanceSchema();

  function hydrateUser(row) {
    if (!row) return undefined;
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.passwordHash,
      passwordSalt: row.passwordSalt,
      displayName: row.displayName,
      jobTitle: row.jobTitle,
      email: row.email,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  function getUserByUsername(username) {
    return hydrateUser(db.prepare(`SELECT id, username, password_hash AS passwordHash, password_salt AS passwordSalt, display_name AS displayName, job_title AS jobTitle, email, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE username = ?`).get(username));
  }

  function getUser(id) {
    return hydrateUser(db.prepare(`SELECT id, username, password_hash AS passwordHash, password_salt AS passwordSalt, display_name AS displayName, job_title AS jobTitle, email, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE id = ?`).get(id));
  }

  function saveUser(user) {
    const timestamp = new Date().toISOString();
    const saved = { ...user, id: user.id || crypto.randomUUID(), email: user.email || '', createdAt: user.createdAt || timestamp, updatedAt: timestamp };
    db.prepare(`INSERT INTO users (id, username, password_hash, password_salt, display_name, job_title, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, password_salt = excluded.password_salt, display_name = excluded.display_name, job_title = excluded.job_title, email = excluded.email, updated_at = excluded.updated_at`).run(saved.id, saved.username, saved.passwordHash, saved.passwordSalt, saved.displayName, saved.jobTitle, saved.email, saved.createdAt, saved.updatedAt);
    return getUser(saved.id);
  }

  function ensureDefaultAdmin({ hash, salt }) {
    const existing = getUserByUsername('admin');
    return existing || saveUser({ username: 'admin', passwordHash: hash, passwordSalt: salt, displayName: 'admin', jobTitle: '平台管理员', email: '' });
  }

  function getModelConfig() {
    const row = db.prepare("SELECT value_json AS valueJson FROM platform_settings WHERE key = 'model_config'").get();
    return row ? JSON.parse(row.valueJson) : undefined;
  }

  function saveModelConfig(config) {
    const saved = {
      source: config.source || 'PLATFORM',
      baseUrl: config.baseUrl,
      modelName: config.modelName,
      modelFamily: config.modelFamily || '',
      encryptedApiKey: config.encryptedApiKey || ''
    };
    db.prepare(`INSERT INTO platform_settings (key, value_json, updated_at) VALUES ('model_config', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`).run(JSON.stringify(saved), new Date().toISOString());
    return getModelConfig();
  }

  function getRuntimeConfig() {
    const row = db.prepare("SELECT value_json AS valueJson FROM platform_settings WHERE key = 'runtime_config'").get();
    if (!row) return undefined;
    const saved = normalizeRuntimeConfig(JSON.parse(row.valueJson));
    const valueJson = JSON.stringify(saved);
    if (valueJson !== row.valueJson) db.prepare("UPDATE platform_settings SET value_json = ?, updated_at = ? WHERE key = 'runtime_config'")
      .run(valueJson, new Date().toISOString());
    return saved;
  }

  function saveRuntimeConfig(config) {
    const saved = normalizeRuntimeConfig(config);
    db.prepare(`INSERT INTO platform_settings (key, value_json, updated_at) VALUES ('runtime_config', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
      .run(JSON.stringify(saved), new Date().toISOString());
    return saved;
  }

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
      SELECT step_id AS id, status, attempts, error, screenshot, logs_json, screenshots_json, api_json, visual_checks_json
      FROM run_steps
      WHERE run_id = ?
      ORDER BY position
    `).all(row.id).map(({ logs_json, screenshots_json, api_json, visual_checks_json, ...step }) => ({ ...step, logs: JSON.parse(logs_json), screenshots: JSON.parse(screenshots_json || '[]'), api: JSON.parse(api_json || 'null') || undefined, visualChecks: JSON.parse(visual_checks_json || '[]') }));
    return {
      id: row.id,
      caseId: row.caseId,
      caseName: row.caseName,
      projectId: row.projectId,
      target: row.target,
      status: row.status,
      allowMutations: Boolean(row.allowMutations),
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
      INSERT INTO test_runs (id, case_id, case_name, batch_id, batch_position, project_id, target, status, allow_mutations, started_at, finished_at, variables_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        case_id = excluded.case_id,
        case_name = excluded.case_name,
        batch_id = COALESCE(excluded.batch_id, test_runs.batch_id),
        batch_position = COALESCE(excluded.batch_position, test_runs.batch_position),
        project_id = excluded.project_id,
        target = excluded.target,
        status = excluded.status,
        allow_mutations = excluded.allow_mutations,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        variables_json = excluded.variables_json
    `).run(run.id, run.caseId, run.caseName || currentCase?.name || '已删除用例', run.batchId || null, run.batchPosition ?? null, projectId, target, run.status, Number(Boolean(run.allowMutations)), run.startedAt, run.finishedAt, JSON.stringify(run.variables || {}));
    db.prepare('DELETE FROM run_steps WHERE run_id = ?').run(run.id);
    const insertStep = db.prepare(`
      INSERT INTO run_steps (run_id, step_id, position, status, attempts, error, screenshot, logs_json, screenshots_json, api_json, visual_checks_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    run.steps.forEach((step, position) => {
      insertStep.run(run.id, step.id, position, step.status, step.attempts, step.error || null, step.screenshot || null, JSON.stringify(step.logs || []), JSON.stringify(step.screenshots || []), JSON.stringify(step.api || null), JSON.stringify(step.visualChecks || []));
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
      allowMutations: Boolean(row.allowMutations),
      plannedCaseCount: Number(row.plannedCaseCount || 0),
      plannedStepCount: Number(row.plannedStepCount || 0),
      runIds,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt
    };
  }

  function writeBatch(batch) {
    const projectId = batch.projectId || defaultProject().id;
    if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) throw new Error('project not found');
    db.prepare(`
      INSERT INTO test_batches (id, project_id, target, name, status, allow_mutations, planned_case_count, planned_step_count, started_at, finished_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        target = excluded.target,
        name = excluded.name,
        status = excluded.status,
        allow_mutations = excluded.allow_mutations,
        planned_case_count = excluded.planned_case_count,
        planned_step_count = excluded.planned_step_count,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at
    `).run(batch.id, projectId, batch.target || null, batch.name, batch.status, Number(Boolean(batch.allowMutations)), Number(batch.plannedCaseCount || 0), Number(batch.plannedStepCount || 0), batch.startedAt, batch.finishedAt, batch.startedAt || new Date().toISOString());
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
      SELECT projects.id, projects.name, projects.web_auth_json AS webAuthJson, projects.created_at AS createdAt, projects.updated_at AS updatedAt,
        SUM(CASE WHEN test_cases.target = 'web' THEN 1 ELSE 0 END) AS webCaseCount,
        SUM(CASE WHEN test_cases.target = 'api' THEN 1 ELSE 0 END) AS apiCaseCount,
        COUNT(test_cases.id) AS caseCount
      FROM projects
      LEFT JOIN test_cases ON test_cases.project_id = projects.id
      GROUP BY projects.id
      ORDER BY projects.created_at, projects.id
    `).all().map((project) => ({ ...hydrateProject(project), webCaseCount: Number(project.webCaseCount), apiCaseCount: Number(project.apiCaseCount), caseCount: Number(project.caseCount) }));
  }

  function getProject(id) {
    return listProjects().find((project) => project.id === id);
  }

  function saveProject(project) {
    const name = project?.name?.trim();
    if (!name) throw new Error('project name required');
    const webAuth = normalizeProjectWebAuth(project.webAuth);
    const timestamp = new Date().toISOString();
    const id = project.id || crypto.randomUUID();
    try {
      if (project.id) {
        const result = db.prepare('UPDATE projects SET name = ?, web_auth_json = ?, updated_at = ? WHERE id = ?').run(name, JSON.stringify(webAuth || null), timestamp, id);
        if (result.changes === 0) throw new Error('project not found');
      } else {
        db.prepare('INSERT INTO projects (id, name, web_auth_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, name, JSON.stringify(webAuth || null), timestamp, timestamp);
      }
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) throw new Error('project name already exists');
      throw error;
    }
    return getProject(id);
  }

  function ensureProjectWebAuth({ name, webAuth }) {
    const normalized = normalizeProjectWebAuth(webAuth);
    if (!normalized) throw new Error('invalid project web auth');
    const result = db.prepare('UPDATE projects SET web_auth_json = ?, updated_at = ? WHERE name = ?').run(JSON.stringify(normalized), new Date().toISOString(), name);
    if (result.changes === 0) throw new Error('project not found');
    return db.prepare('SELECT id FROM projects WHERE name = ?').get(name).id;
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
        CASE WHEN b.planned_case_count > 0 THEN b.planned_case_count ELSE (SELECT COUNT(*) FROM batch_cases WHERE batch_id = b.id) END AS totalCases,
        (SELECT COUNT(*) FROM test_runs WHERE batch_id = b.id AND status IN ('passed', 'failed', 'skipped')) AS completedCases,
        CASE WHEN b.planned_step_count > 0 THEN b.planned_step_count ELSE (SELECT COUNT(*) FROM run_steps JOIN test_runs ON test_runs.id = run_steps.run_id WHERE test_runs.batch_id = b.id) END AS totalSteps,
        (SELECT COUNT(*) FROM run_steps JOIN test_runs ON test_runs.id = run_steps.run_id WHERE test_runs.batch_id = b.id AND run_steps.status IN ('passed', 'failed', 'skipped')) AS completedSteps,
        (SELECT case_name FROM test_runs WHERE batch_id = b.id AND status IN ('queued', 'running') ORDER BY batch_position, id LIMIT 1) AS currentCaseName
      FROM test_batches AS b
      LEFT JOIN projects AS p ON p.id = b.project_id
      ${batchFilters.where}
    `).all(...batchFilters.parameters).map((row) => ({ ...row, kind: 'batch', totalCases: Number(row.totalCases), completedCases: Number(row.completedCases), totalSteps: Number(row.totalSteps), completedSteps: Number(row.completedSteps) }));
    const runs = db.prepare(`
      SELECT r.id, r.project_id AS projectId, p.name AS projectName, r.target, r.case_name AS name, r.status,
        r.started_at AS startedAt, r.finished_at AS finishedAt,
        1 AS totalCases, CASE WHEN r.status IN ('passed', 'failed', 'skipped') THEN 1 ELSE 0 END AS completedCases,
        (SELECT COUNT(*) FROM run_steps WHERE run_id = r.id) AS totalSteps,
        (SELECT COUNT(*) FROM run_steps WHERE run_id = r.id AND status IN ('passed', 'failed', 'skipped')) AS completedSteps,
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
    const terminal = "status IN ('passed', 'failed', 'skipped')";
    const batchWhere = [terminal.replaceAll('status', 'b.status'), 'b.finished_at >= ?', batchFilters.where.replace(/^WHERE /, '')].filter(Boolean).join(' AND ');
    const runWhere = [terminal.replaceAll('status', 'r.status'), 'r.finished_at >= ?', 'r.batch_id IS NULL', runFilters.where.replace(/^WHERE /, '')].filter(Boolean).join(' AND ');
    const batches = db.prepare(`
      SELECT b.id, b.name, b.project_id AS projectId, p.name AS projectName, b.target, b.status,
        b.started_at AS startedAt, b.finished_at AS finishedAt,
        (SELECT COUNT(*) FROM test_runs WHERE batch_id = b.id AND status = 'passed') AS passedCases,
        (SELECT COUNT(*) FROM test_runs WHERE batch_id = b.id AND status = 'failed') AS failedCases,
        (SELECT COUNT(*) FROM test_runs WHERE batch_id = b.id AND status = 'skipped') AS skippedCases
      FROM test_batches AS b LEFT JOIN projects AS p ON p.id = b.project_id
      WHERE ${batchWhere}
    `).all(start, ...batchFilters.parameters).map((row) => ({ ...row, kind: 'batch', reportUrl: `/api/batches/${encodeURIComponent(row.id)}/report`, passedCases: Number(row.passedCases), failedCases: Number(row.failedCases), skippedCases: Number(row.skippedCases) }));
    const runs = db.prepare(`
      SELECT r.id, r.case_name AS name, r.project_id AS projectId, p.name AS projectName, r.target, r.status,
        r.started_at AS startedAt, r.finished_at AS finishedAt,
        CASE WHEN r.status = 'passed' THEN 1 ELSE 0 END AS passedCases,
        CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END AS failedCases,
        CASE WHEN r.status = 'skipped' THEN 1 ELSE 0 END AS skippedCases
      FROM test_runs AS r LEFT JOIN projects AS p ON p.id = r.project_id
      WHERE ${runWhere}
    `).all(start, ...runFilters.parameters).map((row) => ({ ...row, kind: 'run', reportUrl: `/api/runs/${encodeURIComponent(row.id)}/report`, passedCases: Number(row.passedCases), failedCases: Number(row.failedCases), skippedCases: Number(row.skippedCases) }));
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

  function assertProject(projectId) {
    if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) throw new Error('project not found');
  }

  function savePerformanceAccountPool(pool) {
    const valid = validateAccountPool(pool);
    assertProject(valid.projectId);
    const timestamp = new Date().toISOString();
    const saved = { ...valid, id: valid.id || crypto.randomUUID(), createdAt: valid.createdAt || timestamp, updatedAt: timestamp };
    db.prepare(`INSERT INTO performance_account_pools (id, project_id, name, accounts_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, name = excluded.name, accounts_json = excluded.accounts_json, updated_at = excluded.updated_at`)
      .run(saved.id, saved.projectId, saved.name, JSON.stringify(saved.accounts), saved.createdAt, saved.updatedAt);
    return publicAccountPool(saved);
  }

  function performancePoolRow(id) {
    return db.prepare(`SELECT id, project_id AS projectId, name, accounts_json AS accountsJson, created_at AS createdAt, updated_at AS updatedAt
      FROM performance_account_pools WHERE id = ?`).get(id);
  }

  function getPerformanceAccountPool(id) {
    const row = performancePoolRow(id);
    return row ? publicAccountPool({ ...row, accounts: JSON.parse(row.accountsJson) }) : undefined;
  }

  function getPerformanceAccountPoolCredentials(id) {
    const row = performancePoolRow(id);
    return row ? JSON.parse(row.accountsJson) : undefined;
  }

  function savePerformanceAsset(asset) {
    if (!asset?.projectId || !asset?.name?.trim() || !asset?.protocol || !asset?.config || typeof asset.config !== 'object') throw new Error('invalid performance asset');
    assertProject(asset.projectId);
    const timestamp = new Date().toISOString();
    const saved = { ...asset, id: asset.id || crypto.randomUUID(), createdAt: asset.createdAt || timestamp, updatedAt: timestamp };
    db.prepare(`INSERT INTO performance_assets (id, project_id, name, protocol, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, name = excluded.name, protocol = excluded.protocol, config_json = excluded.config_json, updated_at = excluded.updated_at`)
      .run(saved.id, saved.projectId, saved.name, saved.protocol, JSON.stringify(saved.config), saved.createdAt, saved.updatedAt);
    return saved;
  }

  function hydratePerformanceAsset(row) {
    if (!row) return undefined;
    const { configJson, ...asset } = row;
    return { ...asset, config: JSON.parse(configJson) };
  }

  function getPerformanceAsset(id) {
    return hydratePerformanceAsset(db.prepare(`SELECT id, project_id AS projectId, name, protocol, config_json AS configJson, created_at AS createdAt, updated_at AS updatedAt
      FROM performance_assets WHERE id = ?`).get(id));
  }

  function listPerformanceAssets(projectId = '') {
    return db.prepare(`SELECT id, project_id AS projectId, name, protocol, config_json AS configJson, created_at AS createdAt, updated_at AS updatedAt
      FROM performance_assets ${projectId ? 'WHERE project_id = ?' : ''} ORDER BY created_at, id`)
      .all(...(projectId ? [projectId] : [])).map(hydratePerformanceAsset);
  }

  function savePerformanceRun(run) {
    if (!run?.id || !run?.assetId || !run?.projectId || !run?.name || !run?.status) throw new Error('invalid performance run');
    assertProject(run.projectId);
    const createdAt = run.createdAt || new Date().toISOString();
    db.prepare(`INSERT INTO performance_runs (id, asset_id, project_id, name, status, summary_json, error, started_at, finished_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, summary_json = excluded.summary_json, error = excluded.error, started_at = excluded.started_at, finished_at = excluded.finished_at`)
      .run(run.id, run.assetId, run.projectId, run.name, run.status, JSON.stringify(run.summary || {}), run.error || null, run.startedAt || null, run.finishedAt || null, createdAt);
    return getPerformanceRun(run.id);
  }

  function appendPerformanceSample(runId, sample) {
    const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM performance_run_samples WHERE run_id = ?').get(runId).position;
    db.prepare('INSERT INTO performance_run_samples (run_id, position, sample_json) VALUES (?, ?, ?)').run(runId, position, JSON.stringify(sample));
    return getPerformanceRun(runId);
  }

  function getPerformanceRun(id) {
    const row = db.prepare(`SELECT id, asset_id AS assetId, project_id AS projectId, name, status, summary_json AS summaryJson, error,
      started_at AS startedAt, finished_at AS finishedAt, created_at AS createdAt FROM performance_runs WHERE id = ?`).get(id);
    if (!row) return undefined;
    const samples = db.prepare('SELECT sample_json AS sampleJson FROM performance_run_samples WHERE run_id = ? ORDER BY position').all(id)
      .map(({ sampleJson }) => JSON.parse(sampleJson));
    return { ...row, summary: JSON.parse(row.summaryJson), samples };
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
    ensureProjectWebAuth,
    deleteProject,
    saveRun,
    getRun(id) {
      return hydrateRun(db.prepare(`
        SELECT id, case_id AS caseId, case_name AS caseName, project_id AS projectId, target, status, allow_mutations AS allowMutations, started_at AS startedAt,
          finished_at AS finishedAt, variables_json AS variablesJson
        FROM test_runs
        WHERE id = ?
      `).get(id));
    },
    deleteCase,
    saveBatch,
    getBatch(id) {
      return hydrateBatch(db.prepare(`
        SELECT id, project_id AS projectId, target, name, status, allow_mutations AS allowMutations, planned_case_count AS plannedCaseCount, planned_step_count AS plannedStepCount, started_at AS startedAt, finished_at AS finishedAt
        FROM test_batches
        WHERE id = ?
      `).get(id));
    },
    listBatches(projectId = '') {
      return db.prepare(`
        SELECT id, project_id AS projectId, target, name, status, allow_mutations AS allowMutations, planned_case_count AS plannedCaseCount, planned_step_count AS plannedStepCount, started_at AS startedAt, finished_at AS finishedAt
        FROM test_batches
        ${projectId ? 'WHERE project_id = ?' : ''}
        ORDER BY created_at, id
      `).all(...(projectId ? [projectId] : [])).map(hydrateBatch);
    },
    listExecutions,
    getDashboard,
    listReports,
    getUserByUsername,
    getUser,
    saveUser,
    ensureDefaultAdmin,
    getModelConfig,
    saveModelConfig,
    getRuntimeConfig,
    saveRuntimeConfig,
    savePerformanceAccountPool,
    getPerformanceAccountPool,
    getPerformanceAccountPoolCredentials,
    savePerformanceAsset,
    getPerformanceAsset,
    listPerformanceAssets,
    savePerformanceRun,
    getPerformanceRun,
    appendPerformanceSample,
    failInterruptedExecutions
  };
}
