# CMS 批量会话与加密 Skill 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为同一 CMS API 批量任务复用一次加密登录会话，并安装不含凭证的 CMS 加密接口 Skill。

**Architecture:** `CmsApiRunner` 提供内存会话与公共认证方法；`RunService` 在单次运行中持有会话，`BatchService` 将同一会话传给批次内的所有 API 用例。认证 token 只驻留会话对象，不进入运行记录。Skill 通过 `init_skill.py` 创建于 Codex 用户技能目录，包含协议、变量和脱敏流程。

**Tech Stack:** Node.js 22、node:crypto、Vitest、Codex Skill Creator。

## Global Constraints

- 认证 token、密钥、IV、appKey、用户名、密码不可写入数据库、报告、证据、Skill 或 Git。
- 仅 API 批次共享会话；Web UI 批次不创建 CMS 会话。
- 不改变 API 用例的 `POST`、结构化断言、变量提取或写操作安全策略。
- 显式 `loginByPassword` 步骤保持兼容，但必须调用公共认证方法且不重复登录。
- Skill 目录为 `~/.codex/skills/cms-encrypted-api`，不纳入仓库。

---

### Task 1: 用测试定义认证会话和批量共享语义

**Files:**
- Modify: `tests/cms-api-runner.test.js:11-97`
- Modify: `tests/batch-service.test.js:21-62`
- Modify: `tests/cms-whitebag-cases.test.js:4-11`

**Interfaces:**
- Consumes: `CmsApiRunner.createSession()`, `CmsApiRunner.authenticate(baseUrl, session)`、`RunService.start(testCase, options)`。
- Produces: 自动登录、单批次一次登录、认证失败不发业务请求及种子用例不含登录步骤的回归覆盖。

- [x] **Step 1: 写入 CMS 执行器失败测试**

加入测试：先执行两个不含 `loginByPassword` 的只读步骤，使用同一 `context.apiSession`，断言模拟 fetch 收到的 actions 为 `['loginByPassword', 'config', 'list_post']`，两个业务请求解密后包含相同 token，且返回的 `variables` 不含 token。

- [x] **Step 2: 写入认证失败测试**

加入测试：登录响应返回失败状态时，连续执行两个业务步骤；断言两个调用都拒绝、fetch 仅被调用一次，且错误中不包含配置凭证。

- [x] **Step 3: 写入批量共享失败测试**

使用真实 `CmsApiRunner` 和内存 store 创建两个 API 用例；运行 `BatchService.start()` 后断言登录 action 仅出现一次，而两个用例各自保存一条通过的运行记录。

- [x] **Step 4: 更新种子用例断言**

断言白包用例首步骤为 `config`，全部步骤的 action 集不含 `loginByPassword`。

- [x] **Step 5: 运行目标测试确认失败**

Run: `npm test -- tests/cms-api-runner.test.js tests/batch-service.test.js tests/cms-whitebag-cases.test.js`

Expected: FAIL，原因是公共认证方法、批量会话传播和种子迁移尚不存在。

### Task 2: 实现内存认证会话和自动加密登录

**Files:**
- Modify: `server/runners/cms-api-runner.js:22-68`

**Interfaces:**
- Produces: `createSession(): { token?: string, authenticationError?: string }`。
- Produces: `authenticate(baseUrl: string, session: object): Promise<object>`；成功时填充 `session.token`，失败时缓存安全错误。
- Consumes: `context.apiSession`，并在没有会话时创建临时会话。

- [x] **Step 1: 添加会话工厂与公共认证方法**

将登录请求的公共客户端字段、用户名和密码经既有 `buildRequestBody()` 加密后发送。解析 `status` 或 `errcode` 成功结果、按需解密响应，并只将非空字符串 token 写入 `session.token`。

- [x] **Step 2: 对业务请求自动认证**

在 `execute()` 中，对非登录步骤先调用 `authenticate()`，然后将会话 token 与公共客户端字段、插值后的 payload 一起加密发送。返回证据前继续调用 `redactSecrets()`。

- [x] **Step 3: 保持显式登录步骤兼容**

当 action 为 `loginByPassword` 时调用 `authenticate()`，复用已存在会话并返回脱敏登录证据；不要把 token 放进 `variables`。

- [x] **Step 4: 运行 CMS 执行器测试确认通过**

Run: `npm test -- tests/cms-api-runner.test.js`

Expected: PASS，包含新会话、自动认证、失败阻断与已有加密协议覆盖。

### Task 3: 向批量和单次运行传递会话

**Files:**
- Modify: `server/services/run-service.js:13-59`
- Modify: `server/services/batch-service.js:3-31`
- Modify: `server/seed/cms-whitebag-cases.js:1-10`

**Interfaces:**
- Consumes: API runner 的可选 `createSession()`。
- Produces: `RunService.start(testCase, { apiSession } = {})`，单次 API 用例拥有临时会话。
- Produces: `BatchService.start()` 为 API 批次创建一次 `apiSession` 并传给每个 `RunService.start()` 调用。

- [x] **Step 1: 扩展 RunService 选项**

在选择 API runner 后，以传入的 `apiSession` 或 `runner.createSession()` 创建执行上下文的会话引用；不要把会话并入 `run.variables`。

- [x] **Step 2: 扩展 BatchService 会话创建**

保存构造函数传入的 `runner`。当 `cases[0].target === 'api'` 且 API runner 提供 `createSession()` 时创建一次会话；在循环中调用 `runService.start(testCase, { apiSession })`。

- [x] **Step 3: 移除白包用例重复登录步骤**

删除共享 `login` 步骤常量，使三条种子用例由 `config` 与各自业务请求构成。

- [x] **Step 4: 运行批量及种子测试确认通过**

Run: `npm test -- tests/batch-service.test.js tests/cms-whitebag-cases.test.js`

Expected: PASS，批量按顺序运行且仅发起一次 CMS 登录。

### Task 4: 创建并验证 CMS 加密接口 Skill

**Files:**
- Create: `~/.codex/skills/cms-encrypted-api/SKILL.md`
- Create: `~/.codex/skills/cms-encrypted-api/agents/openai.yaml`
- Create: `~/.codex/skills/cms-encrypted-api/references/protocol.md`

**Interfaces:**
- Consumes: CMS AES-CBC、签名、响应解密与脱敏协议。
- Produces: 由 `cms-encrypted-api` 元数据触发的本地 Codex Skill。

- [x] **Step 1: 初始化 Skill 目录**

Run:

```bash
python3 /Users/zhangweiar/.codex/skills/.system/skill-creator/scripts/init_skill.py cms-encrypted-api --path /Users/zhangweiar/.codex/skills --resources references --interface 'display_name=CMS Encrypted API' --interface 'short_description=Build and debug encrypted CMS API tests safely.' --interface 'default_prompt=Use $cms-encrypted-api to create a redacted CMS API test flow.'
```

- [x] **Step 2: 编写精简 Skill 与协议参考**

`SKILL.md` 必须要求从环境变量读取敏感配置、使用 AES-128-CBC 与 `MD5(SHA256(...))` 签名、处理加密响应、在批量中复用内存会话，并在日志与报告中脱敏。`references/protocol.md` 只描述字段、算法、伪代码和结构化步骤示例。

- [x] **Step 3: 校验 Skill 和敏感信息边界**

Run:

```bash
python3 /Users/zhangweiar/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/zhangweiar/.codex/skills/cms-encrypted-api
rg -n 'CMS_AES_KEY=|CMS_PASSWORD=|[A-Fa-f0-9]{32}' /Users/zhangweiar/.codex/skills/cms-encrypted-api
```

Expected: 验证通过；扫描不出现真实配置值或 32 位密钥材料。

### Task 5: 完整验证和提交

**Files:**
- Verify: `server/runners/cms-api-runner.js`, `server/services/run-service.js`, `server/services/batch-service.js`, `server/seed/cms-whitebag-cases.js`, `tests/*.test.js`

- [x] **Step 1: 运行 CMS 和服务层全量相关测试**

Run: `npm test -- tests/cms-api-runner.test.js tests/batch-service.test.js tests/cms-whitebag-cases.test.js tests/run-service.test.js tests/case.test.js`

Expected: 所有目标测试通过。

- [x] **Step 2: 执行语法和差异检查**

Run: `node --check server/runners/cms-api-runner.js && node --check server/services/run-service.js && node --check server/services/batch-service.js && git diff --check`

Expected: 退出码 0。

- [x] **Step 3: 检查提交内容**

Run: `git status --short` 和 `git diff --name-only`。

Expected: 仓库提交只包含实现、测试及本计划；`~/.codex/skills` 不被 Git 跟踪。
