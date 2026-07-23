# Midscene 步骤截图证据设计

## 目标

为 Web UI 用例的每个 Midscene 执行步骤保存可追溯的截图证据，并在测试报告中展示缩略图与原图链接。每次运行和每次重试的截图必须互不覆盖，已删除用例的历史报告仍可访问其证据。

## 范围

- 仅覆盖 Web UI 的 `action`、`assert`、`query` 步骤。
- 每次尝试均保存一张截图：成功后为完成态，抛错后为失败态。
- 截图保存在本地 `data/evidence/<runId>/` 目录。
- 报告按步骤展示所有截图、状态、自然语言指令与错误信息。
- 新增受控的只读证据 HTTP 路由。
- 不增加对象存储、截图保留策略、人工批注、视觉差异比对或 API 测试截图。

## 数据流

1. `RunService` 创建 UUID 运行 ID，并把它放入执行上下文。
2. `WebRunner` 在一次尝试完成或抛错后调用 Playwright `page.screenshot`，路径为 `<runId>/<stepId>-attempt-<n>.png`。
3. Runner 返回单个 `screenshot`（兼容现有消费者）及 `screenshots` 数组。数组元素具有 `path`、`attempt`、`phase`（`passed` 或 `failed`）字段。
4. `RunService` 将本次尝试的证据合并到 `stepRun.screenshots`；成功步骤的 `stepRun.screenshot` 指向最后成功截图，失败步骤指向最后失败截图。
5. SQLite 将 `screenshots` 序列化到现有 `run_steps.logs_json` 同级的新 JSON 字段；内存 Store 原样保存运行对象。
6. 报告使用运行记录渲染证据缩略图，图片资源从受控 API 获取。

## 存储兼容性

`run_steps` 新增可空的 `screenshots_json TEXT NOT NULL DEFAULT '[]'`。启动时检查列是否存在并通过幂等迁移补齐；旧运行记录读取时返回空数组。既有 `screenshot` 字段继续作为最后一张证据路径，避免破坏现有报告、API 和批次历史。

证据路径在数据库中保存为相对路径，例如 `run-uuid/s1-attempt-1.png`，不保存绝对文件系统路径。

## HTTP 接口

`GET /api/runs/:runId/evidence/:fileName`

- 仅当运行记录存在，且 `fileName` 等于该运行任一步骤的 `screenshot` 或 `screenshots[].path` 的 basename 时返回图片。
- 仅接受文件名，不接受目录、`..` 或绝对路径；服务端使用 `path.basename` 与已持久化证据白名单双重校验，再从该运行 ID 对应的目录读取文件。
- 未知运行、未知文件或不在该运行白名单中的文件均返回 `404`。

报告中的图片 URL 使用该接口，不通过静态目录暴露 `data/evidence`。

## 报告展示

每个步骤在报告表格中显示：步骤 ID、自然语言指令、状态、尝试次数、错误与证据区。证据区按尝试顺序呈现缩略图，缩略图可打开原图。失败重试时可同时查看失败截图与随后成功截图。

对旧运行（无 `screenshots`）则回退到旧 `screenshot` 字段；无截图时显示 `-`。

## 错误处理

- 业务步骤失败后，截图失败不得掩盖原始 Midscene 错误；日志记录截图保存异常，随后按既有重试策略继续。
- 业务步骤成功但截图失败时，该尝试仍视为成功，截图数组为空并记录警告。
- 创建证据目录失败属于运行基础设施错误，返回明确错误并由既有运行流程标记失败。

## 测试验收

1. 同一 `stepId` 在不同运行中写入不同运行目录。
2. 失败后重试会保留失败态和成功态两张截图，顺序与尝试次数一致。
3. 旧运行记录没有 `screenshots` 时仍可读取和渲染报告。
4. SQLite 持久化并恢复 `screenshots` 数组，迁移可重复执行。
5. 证据接口仅返回该运行已登记的文件，目录穿越和任意文件访问均为 `404`。
6. HTML 报告包含安全转义的步骤指令、缩略图及原图链接。
