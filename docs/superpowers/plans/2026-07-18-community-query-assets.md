# 方舟社区查询资产与工具栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改善项目资产搜索和筛选布局，收敛用户可见技术文案，并接入三条方舟社区只读查询用例。

**Architecture:** 前端继续调用既有 `GET /api/cases?q=&projectId=` 实现名称模糊搜索，只用 CSS 为搜索、类型筛选和刷新控件建立稳定尺寸。查询用例通过现有 HTTP API 幂等写入目标项目，执行器继续处理认证、加密、解密和脱敏，不把运行时 CMS 地址或凭据写入源码。

**Tech Stack:** Vanilla JavaScript、CSS、Node.js 22、Express、Vitest、SQLite、Node 原生 fetch。

## Global Constraints

- 用户可见资产、编辑器和报告文案不得出现“CMS”或“解密”。
- 不变更加密、自动响应解析、会话复用和敏感数据掩码的服务端行为。
- 新增接口用例全部使用 `POST`、`readonly` 和业务状态 `1`；不得执行写操作。
- CMS 地址、密钥、账号、密码、token、传输密文与签名只能从运行时读取，绝不写入源代码、用例、报告或提交。

---

### Task 1: 固定资产工具栏比例并收敛编辑器文案

**Files:**
- Modify: `style.css:161-190`
- Modify: `app.js:90-103, 222-228`
- Modify: `index.html:74`
- Modify: `tests/styles.test.js:9-59`

**Interfaces:**
- Consumes: `#assetSearch` 输入事件和 `#assetTargetFilter` change 事件的现有 `loadSavedCases()` 调用。
- Produces: 桌面端三列工具栏和移动端可折行工具栏；接口编辑器面向用户显示“接口测试执行”。

- [ ] **Step 1: 写入失败测试**

在 `tests/styles.test.js` 增加以下断言：

```js
expect(stylesheet).toContain('.asset-toolbar { display: grid; grid-template-columns: minmax(260px, 1fr) 180px 36px;');
expect(stylesheet).toContain('.asset-toolbar select { width: 180px; }');
expect(script).toContain('<b>接口测试执行</b><small>结构化 POST 请求 · 断言、变量提取</small>');
expect(script).not.toContain('CMS 加密接口执行');
expect(html).not.toContain('社区 CMS');
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL，因为当前工具栏是无尺寸约束的 flex 布局，且存在“CMS 加密接口执行”及“社区 CMS”示例文案。

- [ ] **Step 3: 最小实现**

在 `style.css` 替换工具栏规则，并覆盖通用 select 宽度：

```css
.asset-toolbar { display: grid; grid-template-columns: minmax(260px, 1fr) 180px 36px; align-items: center; gap: 9px; margin-top: 18px; }
.asset-toolbar select { width: 180px; height: 36px; }
.asset-search { min-width: 0; }
@media (max-width: 760px) {
  .asset-toolbar { grid-template-columns: minmax(0, 1fr) 36px; }
  .asset-toolbar select { grid-column: 1 / -1; width: 100%; }
}
```

在 `app.js` 的两个 API 设备状态模板中使用：

```html
<b>接口测试执行</b><small>结构化 POST 请求 · 断言、变量提取</small>
```

将 `index.html` 的项目名示例改为“例如：社区内容管理”。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test -- tests/styles.test.js`

Expected: PASS；搜索控件、固定筛选控件和用户文案断言均通过。

- [ ] **Step 5: 浏览器检查**

打开方舟社区发帖项目资产页，确认搜索框可输入且位于工具栏左侧，下拉框宽度为固定窄列，输入“帖子”后仅保留名称包含“帖子”的用例。

- [ ] **Step 6: 提交**

```bash
git add style.css app.js index.html tests/styles.test.js
git commit -m "fix: refine asset search toolbar"
```

### Task 2: 将 API 报告用语调整为响应内容

**Files:**
- Modify: `server/services/report-service.js:17-24`
- Modify: `tests/app.test.js:261-282`

**Interfaces:**
- Consumes: API 运行证据 `api.response`。
- Produces: 报告折叠区标题“响应内容”，仍调用 `redactBusinessSecrets` 处理业务对象。

- [ ] **Step 1: 写入失败测试**

将报告测试断言替换为：

```js
expect(report).toContain('响应内容');
expect(report).not.toContain('解密后响应');
expect(report).toContain('********');
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- tests/app.test.js -t "renders redacted API request and response evidence in a report"`

Expected: FAIL，因为报告当前标题为“解密后响应”。

- [ ] **Step 3: 最小实现**

在 `server/services/report-service.js` 的 API 证据模板中将：

```html
<summary>解密后响应</summary>
```

替换为：

```html
<summary>响应内容</summary>
```

不得改变请求摘要、`redactTransportSecrets` 或 `redactBusinessSecrets` 调用。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test -- tests/app.test.js -t "renders redacted API request and response evidence in a report"`

Expected: PASS；响应内容存在，旧文案和明文敏感字段不存在。

- [ ] **Step 5: 提交**

```bash
git add server/services/report-service.js tests/app.test.js
git commit -m "fix: simplify API report response label"
```

### Task 3: 幂等写入并执行方舟社区查询用例

**Files:**
- Modify: SQLite 运行时测试资产与运行记录，只通过现有 HTTP API 写入；不修改源码。
- Verify: `/api/projects`、`/api/cases`、`/api/cases/:id/runs`、`/api/runs/:id/report`。

**Interfaces:**
- Consumes: `POST /api/cases` 和 `PUT /api/cases/:id`。
- Produces: 方舟社区发帖项目的“社区发布配置查询”以及 3 条单步骤只读查询用例和对应运行报告。

- [ ] **Step 1: 检查运行状态**

Run: `curl -fsS http://127.0.0.1:4173/api/health && curl -fsS http://127.0.0.1:4173/api/projects`

Expected: CMS API 执行器就绪，并找到“方舟社区发帖”项目。仅报告缺失环境变量名称，不读取或显示变量值。

- [ ] **Step 2: 幂等写入资产**

运行一个不输出环境变量、请求 body 或响应正文的 Node 脚本。脚本从运行时 `CMS_BASE_URL` 读取基础地址，按名称创建或更新以下 API 用例：

```js
[
  { name: '社区发布配置查询', action: 'config', payload: {} },
  { name: '帖子列表查询', action: 'list_post', payload: { status: 10 } },
  { name: '评论列表查询', action: 'list_post_comments', payload: { status: 0 } },
  { name: '用户资料修改记录查询', action: 'list_member_update_log', payload: { status: 10 } }
]
```

每个用例包含一个 `apiRequest` 步骤，`method: 'POST'`、`expectedStatus: 1`、`safety: 'readonly'`、空断言和空变量提取。脚本只输出名称、用例 ID 和创建或更新状态。

- [ ] **Step 3: 单条执行新增查询用例**

对三条新增用例分别调用 `POST /api/cases/:id/runs`，查询运行与报告。仅输出每条的名称、运行状态、步骤 action、报告是否包含“响应内容”和 `********`；不得输出业务响应正文、token、密钥、密文或签名。

- [ ] **Step 4: 验收与清理**

确认三条运行均为 `passed`，报告中不存在“解密后响应”，并保持响应对象已脱敏。运行数据保留在 SQLite；不提交数据库、报告、证据、`.env` 或 `.DS_Store`。

- [ ] **Step 5: 提交检查**

Run: `git status --short`

Expected: 仅存在既有的运行时未跟踪项，不包含本任务需要提交的源代码更改。

