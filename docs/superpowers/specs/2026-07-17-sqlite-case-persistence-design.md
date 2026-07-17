# SQLite 用例持久化设计

## 目标

将当前基于 `data/store.json` 的用例、批次与运行结果持久化替换为 SQLite 数据库，使功能用例结构、步骤顺序、批次关联和执行历史能够独立查询、完整约束并在服务重启后保留。

## 范围

- 数据库采用本地 SQLite，默认文件为 `data/novatest.db`。
- 本阶段支持现有 Web UI 用例、自然语言步骤、串行批次和运行报告。
- 保持既有 HTTP API、页面以及 `RunService`、`BatchService` 对 Store 的调用方式不变。
- 不引入用户、项目、标签、用例版本、软删除或并发任务队列。

## 领域模型

### 用例与步骤

`test_cases` 保存可编辑用例的稳定元数据：

| 列 | 说明 |
|---|---|
| `id` | UUID 主键 |
| `name` | 用例名称 |
| `target` | 当前固定为 `web` |
| `base_url` | 被测系统地址 |
| `viewport` | `desktop` 或 `mobile` |
| `created_at` | 创建时间 |
| `updated_at` | 最近保存时间 |

`test_steps` 保存步骤，使用 `case_id` 外键关联用例，并以 `position` 定义唯一的执行顺序：

| 列 | 说明 |
|---|---|
| `id` | 步骤 UUID 主键，沿用既有步骤标识 |
| `case_id` | 外键，删除用例时级联删除步骤 |
| `position` | 从 0 开始的步骤顺序，`case_id + position` 唯一 |
| `kind` | `action`、`assert` 或 `query` |
| `instruction` | Midscene 自然语言指令 |

读取用例时，Store 按 `position` 还原当前 API 使用的 `{ ...case, steps }` 结构。

### 批次与批次项

`test_batches` 保存批次汇总状态：`id`、`name`、`status`、`started_at`、`finished_at`、`created_at`。

`batch_cases` 记录某批次选择的每个用例：`batch_id`、`case_id`、`position`。主键为 `batch_id + case_id`，并对 `batch_id + position` 加唯一约束。这样一个用例不会在同一批次重复，且执行顺序可独立于创建时间稳定保存。

### 运行与步骤结果

`test_runs` 保存每个用例的一次执行：`id`、`case_id`、可空的 `batch_id`、`status`、`started_at`、`finished_at`、`variables_json`。

`run_steps` 保存步骤级结果：`run_id`、`step_id`、`position`、`status`、`attempts`、`error`、`screenshot`、`logs_json`。其中变量与日志是结构不固定的运行证据，使用 JSON 文本保存；截图继续保存既有文件路径。`run_id + position` 唯一，确保报告输出顺序可预测。

## Store 边界

新增 `server/storage/sqlite-store.js`，实现当前 Store 协议：

- `saveCase`、`getCase`、`listCases`
- `saveRun`、`getRun`
- `saveBatch`、`getBatch`、`listBatches`

`createMemoryStore()` 保留给 API 与服务单元测试。生产入口从 `createFileStore('data/store.json')` 切换到 SQLite Store。服务层不接触 SQL，也不感知数据表。

`saveCase` 在单个数据库事务中写入用例并完全替换其步骤；失败时不会留下部分步骤。`saveRun` 在单个事务中写入运行记录和全部步骤结果。`saveBatch` 维护批次元数据与有序 `batch_cases`，`getBatch` 仍返回现有 `caseIds` 与 `runIds` 形状以保证 API 兼容。

## JSON 数据迁移

首次创建 SQLite Store 时执行以下规则：

1. 创建全部表、外键和唯一索引。
2. 若 `test_cases` 已有记录，不读取 JSON 文件。
3. 若数据库为空且 `data/store.json` 存在，在一个 SQLite 事务中导入全部 cases、runs、batches 及其嵌套数据，并在提交前将原文件重命名为 `data/store.json.migrated`；若该备份已存在，保留原 JSON 文件不覆盖备份。
4. SQLite 提交失败时，若本次已创建迁移备份且源文件不存在，则将备份改回源文件。
5. 导入、重命名或提交失败时报告启动错误，回滚数据库事务并保留原 JSON 文件。

导入批次时，根据 `caseIds` 和 `runIds` 分别创建 `batch_cases` 与 `test_runs.batch_id` 关联。缺失的历史用例或运行 ID 不创建无效外键记录；其余有效记录仍导入。

## 错误处理与验证

- SQLite 打开时强制启用 `PRAGMA foreign_keys = ON`。
- 所有写操作使用预编译参数，禁止拼接用户输入为 SQL。
- 不合法状态、重复步骤位置、重复批次用例、未知外键将由应用校验或 SQLite 约束拒绝。
- 报告读取遇到不存在运行记录时继续返回现有 `404` 行为。

## 测试验收

1. 新建用例后，重启 SQLite Store 仍按原步骤顺序读取。
2. 保存同一用例会原子替换旧步骤，不遗留多余记录。
3. 单次运行及其步骤、变量、日志和截图路径可重启后读取。
4. 批次项保存选择顺序，重启后可还原 `caseIds`、`runIds` 和状态。
5. JSON 文件首次迁移后，数据可完整读取且生成 `.migrated` 备份。
6. 迁移失败时，数据库无部分导入记录，JSON 源文件仍在。
7. 既有 API 测试继续通过，页面不需要修改才能读取 SQLite 中的用例库和批次历史。
