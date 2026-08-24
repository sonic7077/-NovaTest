# Editable AI Model Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated administrator edit Midscene model settings for future Web UI tasks and see CMS deployment readiness without exposing secrets.

**Architecture:** Encrypt API keys with `PLATFORM_CONFIG_ENCRYPTION_KEY` and store the resulting override in SQLite. A reloadable runner swaps only after a candidate initializes successfully. The model page becomes an admin form and displays CMS health from the existing health endpoint.

**Tech Stack:** Node.js 22 `node:crypto`, SQLite `DatabaseSync`, Express, Vitest, browser DOM APIs, Midscene Playwright.

## Global Constraints

- API keys never appear in plaintext outside the save request.
- A blank API key retains the stored value; `clearApiKey: true` clears it.
- Active work retains its current runner; saved configuration affects future Web UI work.
- CMS secrets remain exclusively in `deploy/test.env`.
- Do not stage `.env`, `data/`, `evidence/`, or `midscene_run/`.

---

### Task 1: Encrypt and Validate Model Overrides

**Files:**
- Create: `server/services/model-config-service.js`
- Create: `tests/model-config-service.test.js`

**Interfaces:** `encryptModelApiKey`, `decryptModelApiKey`, `normalizeModelConfig`, and `publicModelConfig`.

- [x] **Step 1: Write failing tests**

```js
it('encrypts a key and exposes only a redacted public value', () => {
  const encrypted = encryptModelApiKey('model-secret', 'a'.repeat(32));
  expect(decryptModelApiKey(encrypted, 'a'.repeat(32))).toBe('model-secret');
  expect(publicModelConfig({ encryptedApiKey: encrypted })).toMatchObject({ apiKey: 'mod****************', hasApiKey: true });
});

it('retains or clears the existing key only as requested', () => {
  expect(normalizeModelConfig({ baseUrl: 'https://model.example', modelName: 'vision', apiKey: '' }, { encryptedApiKey: 'saved' })).toMatchObject({ encryptedApiKey: 'saved' });
  expect(normalizeModelConfig({ baseUrl: 'https://model.example', modelName: 'vision', apiKey: '', clearApiKey: true }, { encryptedApiKey: 'saved' })).toMatchObject({ encryptedApiKey: '' });
});
```

- [x] **Step 2: Verify the test is red**

Run: `npm test -- tests/model-config-service.test.js`

Expected: FAIL with a missing module.

- [x] **Step 3: Implement the service**

Use AES-256-GCM with an SHA-256 derived key, serializing IV, tag, and ciphertext as base64url. Require HTTP/HTTPS URLs, a non-empty model name, 500-character input limits, and a deployment encryption key before encrypting a new API key.

- [x] **Step 4: Verify the test is green**

Run: `npm test -- tests/model-config-service.test.js`

Expected: PASS.

- [x] **Step 5: Commit the task**

Run: `git add server/services/model-config-service.js tests/model-config-service.test.js && git commit -m "feat: add encrypted model configuration service"`

### Task 2: Persist and Atomically Reload the Web Runner

**Files:**
- Modify: `server/storage/sqlite-store.js`
- Modify: `server/app.js`
- Modify: `server/index.js`
- Create: `server/services/reloadable-web-runner.js`
- Modify: `tests/sqlite-store.test.js`
- Modify: `tests/app.test.js`
- Create: `tests/reloadable-web-runner.test.js`

**Interfaces:** Store methods `getModelConfig()` and `saveModelConfig(config)`; proxy methods `execute`, `finish`, and `replace`; protected `PUT /api/model-config`.

- [x] **Step 1: Write failing persistence and swap tests**

```js
it('persists an encrypted model override', () => {
  store.saveModelConfig({ baseUrl: 'https://model.example', modelName: 'vision', modelFamily: 'gemini', encryptedApiKey: 'ciphertext' });
  expect(store.getModelConfig()).toMatchObject({ modelName: 'vision', encryptedApiKey: 'ciphertext' });
});

it('keeps the active runner when replacement fails', async () => {
  const runner = createReloadableWebRunner({ current: readyRunner });
  await expect(runner.replace(Promise.reject(new Error('model unavailable')))).rejects.toThrow('model unavailable');
  await runner.execute(step, context);
  expect(readyRunner.execute).toHaveBeenCalled();
});
```

- [x] **Step 2: Verify the test is red**

Run: `npm test -- tests/sqlite-store.test.js tests/app.test.js tests/reloadable-web-runner.test.js`

Expected: FAIL because no model setting, update route, or proxy exists.

- [x] **Step 3: Implement storage, proxy, and route**

Create a `platform_settings` table keyed by `model_config`, storing JSON with only `encryptedApiKey`. Build a candidate runner first; persist and replace only after it resolves. Require the existing authenticated session for updates and return only `publicModelConfig`.

- [x] **Step 4: Verify backend behavior**

Run: `npm test -- tests/model-config-service.test.js tests/sqlite-store.test.js tests/app.test.js tests/reloadable-web-runner.test.js`

Expected: PASS.

- [x] **Step 5: Commit the task**

Run: `git add server/storage/sqlite-store.js server/app.js server/index.js server/services/reloadable-web-runner.js tests/sqlite-store.test.js tests/app.test.js tests/reloadable-web-runner.test.js && git commit -m "feat: persist and reload model configuration"`

### Task 3: Replace the Read-only Model Page

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`
- Modify: `tests/styles.test.js`

**Interfaces:** Form `modelConfigForm`; inputs `modelBaseUrl`, `modelName`, `modelFamily`, `modelApiKey`, and `clearModelApiKey`; function `saveModelConfig(event)`.

- [x] **Step 1: Write failing static UI checks**

```js
expect(html).toContain('id="modelConfigForm"');
expect(html).toContain('id="modelApiKey"');
expect(html).toContain('id="clearModelApiKey"');
expect(script).toContain('async function saveModelConfig(event)');
expect(script).toContain("fetch('/api/model-config', { method: 'PUT'");
expect(stylesheet).toContain('.model-config-form');
expect(stylesheet).toContain('.model-config-health');
```

- [x] **Step 2: Verify the UI check is red**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL because the model page is read-only.

- [x] **Step 3: Implement the editor**

Use labelled native controls. Never refill the key field; show only “已保存” when `hasApiKey` is true. On save, send the five form values to `PUT /api/model-config`, clear the key field, reload config, and render Web UI plus CMS health messages.

- [x] **Step 4: Verify the UI check is green**

Run: `npm test -- tests/styles.test.js`

Expected: PASS.

- [x] **Step 5: Commit the task**

Run: `git add index.html app.js style.css tests/styles.test.js && git commit -m "feat: make model configuration editable"`

### Task 4: Document Deployment and Perform Final Verification

**Files:**
- Modify: `deploy/test.env.example`
- Modify: `README.md`
- Modify: `tests/app.test.js`

- [x] **Step 1: Write a failing template assertion**

```js
expect(deploymentTemplate).toContain('PLATFORM_CONFIG_ENCRYPTION_KEY=');
expect(deploymentTemplate).toContain('CMS_BASE_URL=');
```

- [x] **Step 2: Verify the assertion is red**

Run: `npm test -- tests/app.test.js`

Expected: FAIL because the encryption key template entry is absent.

- [x] **Step 3: Document deployment values**

Add `PLATFORM_CONFIG_ENCRYPTION_KEY=` with a server-only random 32+ character requirement. Document that `missing CMS_*` requires controlled CMS values in `/opt/auto_test/deploy/test.env`, followed by `docker compose -f docker-compose.deploy.yml --env-file deploy/test.env up -d --build`.

- [x] **Step 4: Run final verification**

Run: `npm test`

Expected: all tests pass. Start port 4173 and verify the editable form, redacted saved key, invalid-update rollback, and CMS health message.

- [x] **Step 5: Inspect and commit the task**

Run: `git diff --check && git status --short && git add deploy/test.env.example README.md tests/app.test.js && git commit -m "docs: document model and CMS deployment configuration"`
