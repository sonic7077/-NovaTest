# API 编辑器布局修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复接口用例编辑器的窄列布局，并让编辑页面包屑显示正确的用例类型。

**Architecture:** 保留 Web UI 步骤的通用四列 `.step` 网格。以 `.api-request` 局部 CSS 覆盖为“序号 + 内容”两列；应用层提供根据当前 `target` 更新编辑器面包屑的函数，供路由和异步用例加载后复用。

**Tech Stack:** 原生 ES modules、CSS Grid、Vitest。

## Global Constraints

- 不修改 API 用例持久化模型、执行器或请求结构。
- Web UI 步骤继续使用 `15px 28px 1fr 24px` 的四列布局。
- API 步骤使用 `28px minmax(0, 1fr)`，字段在第二列可收缩。
- 不提交 `.env`、`data/`、`evidence/` 或 `.DS_Store`。

---

### Task 1: 编写布局与文案回归测试

**Files:**
- Modify: `tests/styles.test.js:9-48`

**Interfaces:**
- Consumes: `style.css` 中的 `.step`、`.api-request` 规则与 `app.js` 中的面包屑更新函数。
- Produces: 对 API 两列布局、字段收缩规则和 API/Web 文案分支的静态回归约束。

- [x] **Step 1: 写入失败测试**

在现有断言后加入：

```js
expect(stylesheet).toContain('.api-request { grid-template-columns: 28px minmax(0, 1fr); }');
expect(stylesheet).toContain('.api-request .step-content { min-width: 0; }');
expect(script).toContain("target === 'api' ? '接口用例编排' : 'Web UI 用例编排'");
expect(script).toContain('function updateEditorBreadcrumb()');
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/styles.test.js`

Expected: FAIL，指出 API 专用网格规则和动态面包屑函数缺失。

- [x] **Step 3: 记录失败原因**

确认失败来自尚未实现的规则或函数，而不是 Vitest、模块加载或测试拼写错误。

### Task 2: 最小化修复 API 布局与编辑器面包屑

**Files:**
- Modify: `style.css:163-171`
- Modify: `app.js:13-30`
- Modify: `app.js:176-191`

**Interfaces:**
- Consumes: 全局 `target`、`#breadcrumb` 与 `.api-request` 节点。
- Produces: `updateEditorBreadcrumb()`，无参数，根据 `target` 更新 `#breadcrumb`；API 步骤的两列 CSS 覆盖。

- [x] **Step 1: 实现最小 CSS 修复**

在 `.api-request` 规则后加入：

```css
.api-request { grid-template-columns: 28px minmax(0, 1fr); }
.api-request .step-content { min-width: 0; }
```

- [x] **Step 2: 实现面包屑更新函数**

在 `renderRoute()` 前加入：

```js
function updateEditorBreadcrumb() {
  $('#breadcrumb').innerHTML = `测试资产 <i data-lucide="chevron-right"></i> <span>${target === 'api' ? '接口用例编排' : 'Web UI 用例编排'}</span>`;
}
```

将 `renderRoute()` 的资产编辑页分支改为调用该函数；在 `applyCase()` 设置 `target` 后调用该函数，确保异步加载接口用例后更新文案。

- [x] **Step 3: 运行回归测试确认通过**

Run: `npm test -- tests/styles.test.js`

Expected: PASS，1 个测试文件且无失败。

### Task 3: 全量验证与页面验收

**Files:**
- Verify only: `app.js`, `style.css`, `tests/styles.test.js`

**Interfaces:**
- Consumes: 已修复的同源 Node 服务。
- Produces: 全量自动化测试、语法检查和浏览器页面证据。

- [ ] **Step 1: 执行全量自动化测试（受沙箱端口权限阻断）**

Run: `npm test`

Expected: 所有 Vitest 测试通过。

- [x] **Step 2: 执行 JavaScript 语法及差异检查**

Run: `node --check app.js`，随后运行 `git diff --check`。

Expected: 两个命令均以退出码 0 完成。

- [x] **Step 3: 浏览器验证编辑 API 用例**

访问同源 Node 服务的 `#/assets/new-api` 和一个既有 API 用例编辑路由，确认步骤序号在左侧、表单内容占用主列、三个首行字段并排展示，且面包屑为“接口用例编排”。

- [x] **Step 4: 浏览器验证 Web UI 不回归**

访问 `#/assets/new-web`，确认面包屑为“Web UI 用例编排”，且 Web UI 步骤维持既有四列结构。

- [x] **Step 5: 提交前检查**

Run: `git status --short` 与本任务文件的 `git diff`。若 `.git` 仍为只读，记录提交受环境权限阻断，不执行破坏性替代操作。
