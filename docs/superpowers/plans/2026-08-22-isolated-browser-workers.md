# 独立浏览器 Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Web UI 批量执行增加隔离浏览器上下文 Worker 并汇总每个账号的执行结果。

**Architecture:** 在 `server/services` 新增有限并发 Worker 池；在 `BatchService` 中按明确的 Web Worker 配置选择 Worker 执行路径。每个 Worker 通过浏览器适配器创建独立 context，并复用现有 `RunService`/`createWebRunner`。汇总结果持久化在 batch 的 `workerSummary` 字段并由现有报告读取。

**Tech Stack:** Node.js 22、Express、Vitest、Playwright 适配器、SQLite/内存 store。

## Global Constraints

- 每个 Worker 使用独立 `BrowserContext`，不得共享 Cookie 或 page。
- Worker 失败不阻塞其他 Worker。
- Worker 完成或失败后必须关闭 page/context。
- 默认并发度为任务数量，最大并发度为 10。
- 不改变现有单用例和 API 批量执行路径。

## Tasks

- [ ] 写 `tests/isolated-browser-worker-pool.test.js` 的失败测试：context 隔离、并发上限、失败隔离、超时清理。
- [ ] 实现 `server/services/isolated-browser-worker-pool.js`，提供 `run(tasks, options)` 和汇总结果。
- [ ] 写批量服务 Worker 集成测试，验证 Web Worker 配置产生 `workerSummary`，普通批量保持原行为。
- [ ] 修改 `server/services/batch-service.js`，增加 `webWorkers` 配置分支和实时 Worker 更新持久化。
- [ ] 修改 `server/services/execution-service.js`/路由参数，将批量请求中的 Worker 配置传入批量服务。
- [ ] 增加报告序列化字段测试，确保汇总内容可被现有报告接口读取。
- [ ] 运行 Worker 专项测试和完整 `npm test`，修复回归。
