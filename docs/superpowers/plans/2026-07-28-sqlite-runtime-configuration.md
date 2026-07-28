# SQLite Runtime Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Web UI, CMS API, and Lighthouse automation from one SQLite runtime configuration and create a database-only deployment package.

**Architecture:** Add one validated `runtime_config` JSON record in `platform_settings`. A one-time bootstrap command imports the local environment; normal startup uses only this record. Code remains deployed by Git, while a package command archives only `data/novatest.db` and a checksum manifest.

**Tech Stack:** Node.js 22, `node:sqlite`, Express, Vitest, native `tar`, Docker Compose.

## Global Constraints

- Normal `server/index.js` startup must not read `MIDSCENE_*`, `WUJI_*`, `CMS_*`, or `LIGHTHOUSE_*` variables.
- `runtime_config` may contain credentials; it must never be returned by HTTP, reports, or logs.
- Do not add a CMS or Lighthouse editor, another deployment mode, or a code archive.
- The only generated artifact is `artifacts/novatest-data-<timestamp>.tar.gz`.
- That archive contains only `data/novatest.db` and `manifest.json`.
- Do not commit `data/`, `artifacts/`, `.env`, evidence, or reports.

---

### Task 1: Add Runtime Configuration Storage

**Files:**
- Create: `server/services/runtime-config-service.js`
- Modify: `server/storage/sqlite-store.js`
- Create: `tests/runtime-config-service.test.js`
- Modify: `tests/sqlite-store.test.js`

**Interfaces:** `normalizeRuntimeConfig(input)`, `runtimeConfigFromEnvironment(env)`, `store.getRuntimeConfig()`, and `store.saveRuntimeConfig(config)`.

- [ ] **Step 1: Write failing validation and persistence tests**

```js
it('normalizes complete model, CMS, and Lighthouse groups', () => {
  const config = normalizeRuntimeConfig(completeRuntimeConfig);
  expect(config).toEqual(completeRuntimeConfig);
  expect(() => normalizeRuntimeConfig({ model: {}, cms: {}, lighthouse: {} }))
    .toThrow('runtime configuration is incomplete');
});

it('persists the runtime configuration record', () => {
  store.saveRuntimeConfig(completeRuntimeConfig);
  expect(store.getRuntimeConfig()).toEqual(completeRuntimeConfig);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- tests/runtime-config-service.test.js tests/sqlite-store.test.js`

Expected: FAIL because the runtime configuration service and store methods do not exist.

- [ ] **Step 3: Implement strict grouping and storage**

```js
export function normalizeRuntimeConfig(input) {
  return {
    model: normalizeModel(input.model),
    cms: normalizeCms(input.cms),
    lighthouse: normalizeLighthouse(input.lighthouse)
  };
}

function saveRuntimeConfig(config) {
  const saved = normalizeRuntimeConfig(config);
  statement.run(JSON.stringify(saved), new Date().toISOString());
  return saved;
}
```

Require an HTTP(S) model URL, model name, model API key, every current `CmsApiRunner` field, plus Lighthouse project name, email, password, and TOTP secret. Errors name fields only, never values. Save one `platform_settings` record keyed by `runtime_config`.

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run: `npm test -- tests/runtime-config-service.test.js tests/sqlite-store.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the task**

Run: `git add server/services/runtime-config-service.js server/storage/sqlite-store.js tests/runtime-config-service.test.js tests/sqlite-store.test.js && git commit -m "feat: persist SQLite runtime configuration"`

### Task 2: Construct Runners From SQLite Only

**Files:**
- Create: `server/services/runtime-services.js`
- Modify: `server/index.js`
- Modify: `server/runners/production-runner.js`
- Modify: `server/services/model-config-manager.js`
- Modify: `server/services/model-config-service.js`
- Create: `tests/runtime-services.test.js`
- Modify: `tests/production-entry.test.js`
- Modify: `tests/production-runner.test.js`
- Modify: `tests/model-config-manager.test.js`

**Interfaces:** `createRuntimeServices({ runtimeConfig, store, createWebRunner, CmsRunner })` returns `{ runner, runnerStatus, cmsRunnerStatus, modelConfigManager, cmsBaseUrl }`. `createProductionRunner({ modelConfig, lighthouseCredentials })` accepts plain objects rather than business environment data.

- [ ] **Step 1: Write failing SQLite-only startup tests**

```js
it('constructs both runners with SQLite configuration', async () => {
  await createRuntimeServices({ runtimeConfig, store, createWebRunner, CmsRunner });
  expect(createWebRunner).toHaveBeenCalledWith(expect.objectContaining({
    modelConfig: runtimeConfig.model,
    lighthouseCredentials: runtimeConfig.lighthouse
  }));
  expect(CmsRunner).toHaveBeenCalledWith({ config: runtimeConfig.cms });
});

it('does not read business configuration from the production entrypoint', async () => {
  expect(entrySource).not.toContain('process.env.CMS_');
  expect(entrySource).not.toContain('process.env.LIGHTHOUSE_');
  expect(entrySource).not.toContain('process.env.MIDSCENE_');
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- tests/runtime-services.test.js tests/production-entry.test.js tests/production-runner.test.js tests/model-config-manager.test.js`

Expected: FAIL because startup currently builds runners from `process.env`.

- [ ] **Step 3: Implement runner factory and replace environment reads**

```js
export async function createRuntimeServices({ runtimeConfig, store, createWebRunner = createProductionRunner, CmsRunner = CmsApiRunner }) {
  const webRunner = await createWebRunner({
    modelConfig: runtimeConfig.model,
    lighthouseCredentials: runtimeConfig.lighthouse
  });
  return {
    runner: { web: createReloadableWebRunner({ current: webRunner }), api: new CmsRunner({ config: runtimeConfig.cms }) },
    cmsBaseUrl: runtimeConfig.cms.baseUrl
  };
}
```

Build the Midscene option object inside `createProductionRunner` from `modelConfig`. Pass Lighthouse credentials directly to `createLighthouseBeforeFirstStep` while retaining its current host and case checks. Replace the encrypted `model_config` record with `runtime_config.model`; update it only after candidate runner initialization succeeds. If SQLite configuration is absent or incomplete, keep the app available with a field-focused unavailable status.

- [ ] **Step 4: Run runner and platform regression tests**

Run: `npm test -- tests/runtime-services.test.js tests/production-entry.test.js tests/production-runner.test.js tests/lighthouse-login.test.js tests/model-config-manager.test.js tests/app.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the task**

Run: `git add server/index.js server/runners/production-runner.js server/services/model-config-manager.js server/services/model-config-service.js server/services/runtime-services.js tests/runtime-services.test.js tests/production-entry.test.js tests/production-runner.test.js tests/model-config-manager.test.js && git commit -m "feat: run automation from SQLite configuration"`

### Task 3: Import Existing Local Configuration Once

**Files:**
- Create: `server/commands/bootstrap-runtime-config.js`
- Modify: `package.json`
- Create: `tests/bootstrap-runtime-config.test.js`

**Interfaces:** `bootstrapRuntimeConfig({ env, databasePath })` returns `{ imported: boolean }`; `npm run config:bootstrap` is the only command that loads `.env`.

- [ ] **Step 1: Write a failing bootstrap test**

```js
it('imports complete environment data once without printing values', () => {
  expect(bootstrapRuntimeConfig({ env: completeEnvironment, databasePath })).toEqual({ imported: true });
  expect(store.getRuntimeConfig()).toMatchObject({ model: { modelName: 'vision' } });
  expect(result.output).not.toContain(completeEnvironment.CMS_PASSWORD);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- tests/bootstrap-runtime-config.test.js`

Expected: FAIL because no bootstrap command exists.

- [ ] **Step 3: Implement the importer**

```js
export function bootstrapRuntimeConfig({ env, databasePath }) {
  const store = createSqliteStore({ databasePath });
  if (store.getRuntimeConfig()) return { imported: false };
  store.saveRuntimeConfig(runtimeConfigFromEnvironment(env));
  return { imported: true };
}
```

Import `dotenv/config` in the command module only. Print `runtime configuration imported` or `runtime configuration already exists`, with no values. Do not import dotenv in `server/index.js`.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `npm test -- tests/bootstrap-runtime-config.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the task**

Run: `git add server/commands/bootstrap-runtime-config.js package.json tests/bootstrap-runtime-config.test.js && git commit -m "feat: bootstrap SQLite runtime configuration"`

### Task 4: Generate A Database-Only Data Package

**Files:**
- Create: `server/services/data-package-service.js`
- Create: `server/commands/package-data.js`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `docker-compose.deploy.yml`
- Modify: `.gitlab-ci.yml`
- Modify: `deploy/test.env.example`
- Modify: `README.md`
- Create: `tests/data-package-service.test.js`
- Modify: `tests/deployment-config.test.js`

**Interfaces:** `createDataPackage({ databasePath, outputDir, timestamp })` returns `{ archivePath, manifestPath, sha256 }`; `npm run package:data` calls it.

- [ ] **Step 1: Write failing packaging and deployment tests**

```js
it('archives exactly the SQLite database and manifest', async () => {
  const result = await createDataPackage({ databasePath, outputDir, timestamp: '20260728-120000' });
  expect(await listTarEntries(result.archivePath)).toEqual(['data/novatest.db', 'manifest.json']);
  expect(await readFile(result.manifestPath, 'utf8')).toContain(result.sha256);
});

it('does not require deploy/test.env for business configuration', () => {
  expect(compose).not.toContain('env_file:');
  expect(ci).not.toContain('deploy/test.env');
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- tests/data-package-service.test.js tests/deployment-config.test.js`

Expected: FAIL because packaging and environment-file removal do not exist.

- [ ] **Step 3: Implement archive creation and code-only deployment inputs**

```js
export async function createDataPackage({ databasePath, outputDir, timestamp }) {
  const sha256 = createHash('sha256').update(await readFile(databasePath)).digest('hex');
  await writeFile(join(outputDir, 'manifest.json'), JSON.stringify({ database: 'data/novatest.db', sha256 }, null, 2));
  await runTar(['-czf', archivePath, '-C', temporaryRoot, 'data/novatest.db', 'manifest.json']);
  return { archivePath, manifestPath, sha256 };
}
```

Fail before creating an archive if the database does not exist. Use a temporary package root so archive entries are exactly `data/novatest.db` and `manifest.json`; remove temporary files afterwards. Ignore `artifacts/`. Remove Compose `env_file`, CI creation of `deploy/test.env`, and CI port parsing; retain only fixed infrastructure host/port values. Rewrite deployment instructions for bootstrap, package, checksum, data extraction, then normal Git deployment.

- [ ] **Step 4: Run the package and deployment tests**

Run: `npm test -- tests/data-package-service.test.js tests/deployment-config.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the task**

Run: `git add server/services/data-package-service.js server/commands/package-data.js package.json .gitignore docker-compose.deploy.yml .gitlab-ci.yml deploy/test.env.example README.md tests/data-package-service.test.js tests/deployment-config.test.js && git commit -m "feat: package SQLite deployment data"`

### Task 5: Bootstrap, Verify, And Produce The Data Package

**Files:** Generated and ignored `data/novatest.db`, `artifacts/manifest.json`, and `artifacts/novatest-data-*.tar.gz`.

- [ ] **Step 1: Populate the database from the current local environment**

Run: `npm run config:bootstrap`

Expected: `runtime configuration imported` or `runtime configuration already exists`, without any secret value.

- [ ] **Step 2: Run all regression tests**

Run: `npm test`

Expected: all test files pass.

- [ ] **Step 3: Verify SQLite-only startup**

Run: `env -u MIDSCENE_MODEL_API_KEY -u CMS_PASSWORD -u LIGHTHOUSE_PASSWORD node server/index.js`

Expected: `/api/health` reports Web UI and CMS readiness using the populated SQLite record.

- [ ] **Step 4: Build and inspect the data package**

Run: `npm run package:data && tar -tzf artifacts/novatest-data-*.tar.gz`

Expected: exactly `data/novatest.db` and `manifest.json` are listed.

- [ ] **Step 5: Final source inspection**

Run: `git diff --check && git status --short`

Expected: source changes are committed; generated database and data-package files remain ignored.
