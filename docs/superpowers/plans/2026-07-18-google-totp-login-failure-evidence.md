# Google TOTP Login And Failure Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate an RFC 6238 verification code from the runtime Google Authenticator secret for CMS login, and preserve redacted API evidence for failed steps.

**Architecture:** A small TOTP service owns Base32 decoding and HMAC-SHA-1 generation. `CmsApiRunner` calls it only in `authenticate()`, then sends the generated code as the encrypted login `secret`; `RunService` saves safe failed-request evidence and the existing report service renders it with a second redaction pass.

**Tech Stack:** Node.js 22 ESM, `node:crypto`, Vitest, Express, SQLite.

## Global Constraints

- Read the Google Authenticator Base32 secret only from `CMS_GOOGLE_SECRET`; never persist or display it.
- Use 30-second, six-digit, HMAC-SHA-1 RFC 6238 TOTP values; never persist or display the generated value.
- Send `secret` only in `loginByPassword`, inside the existing encrypted payload; business API payloads must not contain it.
- Mask token, password, secret, data, sign, key and iv with `********` in all evidence and reports; mask the entire login response.
- Do not add `.env`, `data/novatest.db`, `evidence/`, or `.DS_Store` to Git.

---

### Task 1: Add RFC 6238 TOTP generation and secret redaction

**Files:**
- Create: `server/services/totp.js`
- Modify: `server/services/cms-crypto.js:4-5`
- Create: `tests/totp.test.js`
- Modify: `tests/cms-crypto.test.js:14-31`

**Interfaces:**
- Produces: `generateTotp(base32Secret, { now = Date.now(), period = 30, digits = 6 } = {}) => string`.
- Produces: both CMS redactors mask a key named `secret`.
- Consumed by: `CmsApiRunner.authenticate()` in Task 2.

- [ ] **Step 1: Write the failing tests**

```js
// tests/totp.test.js
import { describe, expect, it } from 'vitest';
import { generateTotp } from '../server/services/totp.js';

describe('TOTP', () => {
  it('returns the RFC 6238 SHA-1 code for a fixed time', () => {
    expect(generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { now: 59_000 })).toBe('287082');
  });
  it('rejects malformed Base32 without exposing its value', () => {
    expect(() => generateTotp('invalid!')).toThrow('invalid Google Authenticator secret');
  });
});
```

Append this test to `tests/cms-crypto.test.js`:

```js
it('masks login secret values in every API evidence boundary', () => {
  expect(redactSecrets({ secret: '123456' })).toEqual({ secret: '********' });
  expect(redactBusinessSecrets({ secret: '123456' })).toEqual({ secret: '********' });
});
```

- [ ] **Step 2: Verify the tests fail for missing behavior**

Run: `npm test -- tests/totp.test.js tests/cms-crypto.test.js`

Expected: FAIL because `totp.js` does not exist and `secret` is not yet masked.

- [ ] **Step 3: Implement the smallest production code**

```js
// server/services/totp.js
import { createHmac } from 'node:crypto';

function decodeBase32(secret) {
  const normalized = String(secret || '').replace(/[\s-]/g, '').toUpperCase();
  if (!normalized || !/^[A-Z2-7]+=*$/.test(normalized)) throw new Error('invalid Google Authenticator secret');
  let bits = '';
  for (const character of normalized.replace(/=+$/, '')) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g)?.map((byte) => Number.parseInt(byte, 2)) || []);
}

export function generateTotp(base32Secret, { now = Date.now(), period = 30, digits = 6 } = {}) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)));
  const digest = createHmac('sha1', decodeBase32(base32Secret)).update(message).digest();
  const offset = digest.at(-1) & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}
```

In `server/services/cms-crypto.js`, change the two regexes to:

```js
const TRANSPORT_SECRET_KEY = /token|password|secret|data|sign|key|iv/i;
const BUSINESS_SECRET_KEY = /token|password|secret|sign|key|iv/i;
```

- [ ] **Step 4: Verify the focused tests pass**

Run: `npm test -- tests/totp.test.js tests/cms-crypto.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the unit**

```bash
git add server/services/totp.js server/services/cms-crypto.js tests/totp.test.js tests/cms-crypto.test.js
git commit -m "feat: generate and redact CMS TOTP codes"
```

### Task 2: Supply the generated code only to encrypted CMS login

**Files:**
- Modify: `server/index.js:8-27`
- Modify: `server/runners/cms-api-runner.js:1-105`
- Modify: `tests/cms-api-runner.test.js:18-39`

**Interfaces:**
- Consumes: `config.googleSecret` from `CMS_GOOGLE_SECRET` and `generateTotp()`.
- Produces: decrypted login payload includes a six-digit `secret`; business request payloads omit that key.

- [ ] **Step 1: Write the failing payload boundary test**

```js
it('sends a generated code only on encrypted login', async () => {
  const payloads = [];
  const runner = new CmsApiRunner({
    config: { ...cryptoConfig, username: 'synthetic-user', password: 'synthetic-password', googleSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' },
    fetchImpl: async (url, options) => {
      payloads.push(JSON.parse(decryptPayload(new URLSearchParams(options.body).get('data'), cryptoConfig)));
      return { ok: true, status: 200, json: async () => encryptedResponse(new URL(url).pathname.endsWith('/loginByPassword') ? 'synthetic-token' : { ok: true }) };
    }
  });
  await runner.execute(apiStep('config'), { testCase: { baseUrl: 'https://example.test' }, variables: {} });
  expect(payloads[0].secret).toMatch(/^\d{6}$/);
  expect(payloads[1]).not.toHaveProperty('secret');
});
```

- [ ] **Step 2: Verify the test fails because login has no `secret`**

Run: `npm test -- tests/cms-api-runner.test.js`

Expected: FAIL with an absent `secret` assertion.

- [ ] **Step 3: Implement runtime configuration and generated login payload**

In `server/index.js`, add `CMS_GOOGLE_SECRET` to `fields` and `googleSecret: process.env.CMS_GOOGLE_SECRET` to the `config` object. In `server/runners/cms-api-runner.js`, add:

```js
import { generateTotp } from '../services/totp.js';

const result = await this.request('loginByPassword', this.clientPayload({
  username: this.config.username,
  password: this.config.password,
  secret: generateTotp(this.config.googleSecret)
}), baseUrl, 1);
```

Do not add `secret` in `execute()` when constructing business request payloads.

- [ ] **Step 4: Verify runner and shared-session behavior**

Run: `npm test -- tests/cms-api-runner.test.js tests/batch-service.test.js`

Expected: PASS, including the existing one-login-per-batch test.

- [ ] **Step 5: Commit the unit**

```bash
git add server/index.js server/runners/cms-api-runner.js tests/cms-api-runner.test.js
git commit -m "feat: send TOTP code for CMS login"
```

### Task 3: Store redacted failure evidence and verify reports

**Files:**
- Modify: `server/runners/cms-api-runner.js:61-87`
- Modify: `server/services/run-service.js:42-47`
- Modify: `tests/cms-api-runner.test.js:83-96`
- Modify: `tests/run-service.test.js:30-40`
- Modify: `tests/app.test.js:280-300`

**Interfaces:**
- Produces: assertion `Error` with safe `api: { action, method, httpStatus, businessStatus, durationMs, request, response }`.
- Consumes: `RunService` copies `error.api` to the failed step.
- Produces: existing `renderReport()` shows both request and response evidence for failed API steps, redacted twice.

- [ ] **Step 1: Write the three failing regression tests**

```js
// cms-api-runner expectation after a business status 0 response
expect(error.api).toMatchObject({
  action: 'list_post', businessStatus: 0,
  request: { token: '********' },
  response: { status: 0, secret: '********', token: '********' }
});
```

```js
// run-service test: runner throws the following twice
const error = new Error('API assertion failed: config');
error.api = { action: 'config', request: { secret: '********' }, response: { status: 0 } };
expect(run.steps[0].api).toEqual(error.api);
```

```js
// report test for a failed API step
expect(report).toContain('请求摘要');
expect(report).toContain('响应内容');
expect(report).toContain('********');
expect(report).not.toContain('synthetic-token');
expect(report).not.toContain('synthetic-password');
expect(report).not.toContain('123456');
```

- [ ] **Step 2: Verify the tests fail because API evidence is discarded**

Run: `npm test -- tests/cms-api-runner.test.js tests/run-service.test.js tests/app.test.js`

Expected: FAIL because status failure errors lack `api` and `RunService` does not save it.

- [ ] **Step 3: Build safe evidence before status evaluation, then persist it**

Replace the duplicate success-only literal in `CmsApiRunner.request()` with:

```js
const api = {
  action, method: 'POST', httpStatus: response.status, businessStatus,
  durationMs: Math.round(performance.now() - startedAt),
  request: redactTransportSecrets(payload),
  response: action === 'loginByPassword' ? '********' : redactBusinessSecrets(data)
};
if (!response.ok || businessStatus !== expectedStatus) {
  const error = new Error(`API assertion failed: ${action}`);
  error.api = api;
  throw error;
}
return { api, data };
```

In the `RunService` catch block, insert `if (error.api) stepRun.api = error.api;` before retry logging.

- [ ] **Step 4: Verify all evidence tests pass**

Run: `npm test -- tests/cms-api-runner.test.js tests/run-service.test.js tests/app.test.js`

Expected: PASS with no synthetic secrets in report markup.

- [ ] **Step 5: Commit the unit**

```bash
git add server/runners/cms-api-runner.js server/services/run-service.js tests/cms-api-runner.test.js tests/run-service.test.js tests/app.test.js
git commit -m "fix: retain redacted API failure evidence"
```

### Task 4: Complete verification and safe live login check

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-google-totp-login-failure-evidence.md` only if an implementation change requires it.

**Interfaces:**
- Consumes: all earlier production code and tests.
- Produces: current suite evidence and a read-only login result that does not emit secrets.

- [ ] **Step 1: Run the full suite**

Run: `npm test`

Expected: PASS with all Vitest tests green.

- [ ] **Step 2: Run one safe, read-only runtime login check**

Run: `node --input-type=module -e "import 'dotenv/config'; import { CmsApiRunner } from './server/runners/cms-api-runner.js'; const e=process.env; const runner=new CmsApiRunner({config:{key:e.CMS_AES_KEY,iv:e.CMS_AES_IV,appKey:e.CMS_APP_KEY,username:e.CMS_USERNAME,password:e.CMS_PASSWORD,googleSecret:e.CMS_GOOGLE_SECRET,oauthId:e.CMS_OAUTH_ID,oauthType:e.CMS_OAUTH_TYPE,version:e.CMS_VERSION,bundleId:e.CMS_BUNDLE_ID,language:e.CMS_LANGUAGE,via:e.CMS_VIA}}); try { await runner.authenticate(e.CMS_BASE_URL, runner.createSession()); console.log('CMS login verification: passed'); } catch (error) { console.log('CMS login verification: failed:', error.message); process.exitCode=1; }"`

Expected: only `CMS login verification: passed`, or a safe failure message. The command must never print a payload, response body, token, code, key, ciphertext, or signature.

- [ ] **Step 3: Verify repository hygiene and commit the plan**

Run: `git status --short && git diff --check`

Expected: no staged or tracked `.env`, database, evidence, or `.DS_Store` changes.

```bash
git add docs/superpowers/plans/2026-07-18-google-totp-login-failure-evidence.md
git commit -m "docs: plan TOTP login evidence"
```
