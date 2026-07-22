# 先锋营自动化测试平台品牌与登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将平台品牌改为先锋营自动化测试平台，并提供可持久化的 `admin` 本地登录与个人资料维护。

**Architecture:** SQLite 新增用户表并保存 scrypt 密码派生值；Express 在生产环境通过 HttpOnly Cookie 会话保护业务 API；浏览器根据会话显示登录页或完整工作台。保留既有 `createApp` 无认证默认值，仅生产入口显式开启认证。

**Tech Stack:** Node.js 22 `crypto`、SQLite `DatabaseSync`、Express、Vanilla ES modules、Vitest、Supertest。

## Global Constraints

- 品牌必须统一为“先锋营自动化测试平台”；删除 NovaTest、当前空间、Atlas Commerce、张伟和 QA Engineer 的演示文本。
- 默认且唯一的本地帐户为 `admin / admin123`，与 CMS 认证凭证严格隔离。
- 密码以随机盐和 `crypto.scrypt` 派生值保存；密码、盐、哈希和会话 ID 不得暴露到页面或 API 响应。
- 未认证 API 返回 `401 { error: '请先登录' }`；认证端点和健康检查例外。
- 修改密码需要旧密码，成功后必须撤销该用户的全部会话。
- 用户资料字段固定为 `displayName`、`jobTitle`、`email`；用户名不可编辑。
- SQLite user_version 从 9 升级为 10；原项目、用例、执行和报告不受影响。

---

## File Structure

- `server/services/auth-service.js`：密码哈希、验证和资料校验。
- `server/storage/sqlite-store.js`：用户迁移、默认管理员和用户持久化方法。
- `server/app.js`：Cookie 会话、认证路由和 API 保护中间件。
- `server/index.js`：生产认证开关。
- `index.html`、`style.css`、`app.js`：品牌、登录页、用户入口和个人资料交互。
- `tests/auth-service.test.js`、`tests/app.test.js`、`tests/sqlite-store.test.js`、`tests/styles.test.js`：行为覆盖。

### Task 1: Password and User Data Contract

**Files:** Create `server/services/auth-service.js`, `tests/auth-service.test.js`.

**Interfaces:** `hashPassword(password)`, `verifyPassword(password, record)`, `publicUser(user)`, `validateProfile(input)`, `validatePasswordChange(input)`.

- [ ] Write the failing test for a correct password, incorrect password, safe public DTO and an eight-character password minimum.

```js
const record = await hashPassword('admin123');
expect(record.hash).not.toContain('admin123');
await expect(verifyPassword('admin123', record)).resolves.toBe(true);
await expect(verifyPassword('wrong-pass', record)).resolves.toBe(false);
expect(publicUser({ id: 'u1', username: 'admin', displayName: 'admin', jobTitle: '平台管理员', email: '', passwordHash: 'x', passwordSalt: 'y' })).toEqual({ id: 'u1', username: 'admin', displayName: 'admin', jobTitle: '平台管理员', email: '' });
```

- [ ] Run `npm test -- tests/auth-service.test.js`; expect failure because the service does not exist.
- [ ] Implement with `randomBytes(16)`, promisified `scrypt`, `timingSafeEqual`, trimming/length limits for profile fields and an optional valid email.
- [ ] Run the focused test; expect pass. Commit `feat: add local account password service`.

### Task 2: SQLite User Migration and Store Contract

**Files:** Modify `server/storage/sqlite-store.js`, `tests/sqlite-store.test.js`.

**Interfaces:** `getUserByUsername(username)`, `getUser(id)`, `saveUser(user)`, `ensureDefaultAdmin({ hash, salt })` on SQLite and memory stores.

- [ ] Add a failing SQLite test that calls `ensureDefaultAdmin` twice, asserts one `admin` record, saves a profile change and reads it back.
- [ ] Run `npm test -- tests/sqlite-store.test.js`; expect failure for missing method.
- [ ] Implement migration 10:

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
  display_name TEXT NOT NULL, job_title TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
```

- [ ] Insert `admin` only when absent, with `displayName: 'admin'`, `jobTitle: '平台管理员'`, and `email: ''`; map all columns to camel-case objects.
- [ ] Mirror the same methods with an in-memory users map in `createMemoryStore`.
- [ ] Run `npm test -- tests/sqlite-store.test.js`; expect pass. Commit `feat: persist local administrator profile`.

### Task 3: Session Authentication API

**Files:** Modify `server/app.js`, `server/index.js`, `tests/app.test.js`.

**Interfaces:** `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`, `PUT /api/auth/profile`, `PUT /api/auth/password`; `createApp({ authRequired = false })`.

- [ ] Add a failing Supertest flow using `request.agent`: business API returns 401 before login; `admin/admin123` logs in; profile saves; password change returns 204 and invalidates session; new password logs in; logout ends the session.
- [ ] Run `npm test -- tests/app.test.js`; expect failure because auth routes are absent.
- [ ] Implement random in-memory session IDs, `novatest_session` `HttpOnly; SameSite=Lax; Path=/` cookie, safe user responses, generic 401 login failure, and a `/api` middleware installed only when `authRequired` is true. Keep `/api/health` and `/api/auth/*` public.
- [ ] On startup with authentication enabled, call `ensureDefaultAdmin(await hashPassword('admin123'))`; password update deletes all sessions for that user.
- [ ] Set `authRequired: true` only in `server/index.js`.
- [ ] Run `npm test -- tests/app.test.js tests/auth-service.test.js`; expect pass. Commit `feat: protect platform with local sessions`.

### Task 4: Brand, Login and Personal Profile Views

**Files:** Modify `index.html`, `style.css`, `tests/styles.test.js`.

**Interfaces:** `#loginScreen`, `#loginForm`, `#loginUsername`, `#loginPassword`, `#loginError`, `#currentUserButton`, `#currentUserAvatar`, `#currentUserName`, `#currentUserTitle`, and profile route `data-route-view="profile"`.

- [ ] Write a failing static contract test for all listed IDs, the pioneer brand, `.login-screen` and `.profile-grid`, and negative assertions for the removed demo text.
- [ ] Run `npm test -- tests/styles.test.js`; expect failure.
- [ ] Replace title/sidebar branding with “先锋营自动化测试平台”; remove the whole workspace switcher; replace the bottom identity with a single user button.
- [ ] Add a full login screen with username/password and an independent profile page with user data form, password form and logout button. Keep all existing test-asset, execution-center, report and model-configuration navigation.
- [ ] Add responsive, restrained styles using existing palette and no decorative gradient or nested-card layout.
- [ ] Run `npm test -- tests/styles.test.js`; expect pass. Commit `feat: add pioneer camp login and profile views`.

### Task 5: Browser Authentication and Profile Workflow

**Files:** Modify `app.js`, `tests/styles.test.js`.

**Interfaces:** `restoreSession()`, `handleLogin(event)`, `renderCurrentUser()`, `saveProfile(event)`, `changePassword(event)`, `logout()`.

- [ ] Extend static tests first with exact route calls to `/api/auth/session`, `/api/auth/login`, `/api/auth/profile`, `/api/auth/password`, and `/api/auth/logout`; run `npm test -- tests/styles.test.js` and expect failure.
- [ ] Add `currentUser`; call `restoreSession()` before rendering routes. A 401 hides the app and shows login; a valid session restores the app and user controls.
- [ ] Submit login/profile/password forms to the specified endpoints. User button navigates to `#/profile`; logout clears state and displays login. Password success clears fields and requires fresh login.
- [ ] Run `npm test -- tests/styles.test.js`; expect pass. Commit `feat: wire local account session in console`.

### Task 6: Complete Verification

**Files:** Modify only if verification exposes a defect.

- [ ] Run `npm test`; expect every suite to pass.
- [ ] Start/reuse one service at `http://127.0.0.1:4173`; use the browser to verify invalid login, `admin/admin123` login, no workspace switcher, profile persistence after refresh, logout, password migration and absence of console errors.
- [ ] Restore the default password to `admin123` after password-change validation so the documented local first-use account remains correct.
- [ ] Run `git diff --check && git status --short`; retain unrelated `.DS_Store`, `.superpowers/` and `evidence/` untouched.
- [ ] Commit only verification-driven corrections as `fix: polish pioneer camp authentication`.

## Plan Self-Review

- The six tasks cover every approved requirement: brand, removal of the confusing space concept, single default admin, session protection, profile/password maintenance and persistence.
- The database migration, API responses, DOM IDs and validation paths use the same field names in every task.
- No user-management, SSO, registration or CMS credential behavior is introduced.
