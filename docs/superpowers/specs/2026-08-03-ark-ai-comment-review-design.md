# 方舟 AI 评论审核接口测试设计

## 目标

在“方舟AI评论审核”项目中保存并执行 AI 评论生成与人工审核接口用例。接口使用标准 JSON 请求和 Bearer JWT，与既有 CMS AES 加密接口隔离；一次批量任务只登录一次，并复用内存中的 JWT。

## 范围

覆盖接口文档中以下能力：

- AI 评论只读查询：`summary`、`configs`、`records`。
- AI 评论审核只读查询：`list`、`stats`。
- 人工终审闭环：从 `manual_review` 记录中选择一条记录，执行 `approve` 或 `reject`，再按记录 ID 回查状态、审核原因和审核时间。

不覆盖 `delete`、`trigger`、评论配置写入、项目开关写入、并发锁与跨项目越权。前四类会产生不可恢复或不受本次任务控制的业务副作用，后两类需要额外的账号和环境编排。

## 运行配置

SQLite 的 `runtime_config` 增加 `editorial` 分组：

- `baseUrl`：方舟测试服根地址，不包含 `/api/editorial`。
- `username`、`password`、`googleSecret`：仅用于登录请求。

该分组沿用当前运行配置的校验与持久化模式。服务进程启动时从 SQLite 读取；可选环境变量只用于首次引导。公开状态接口和报告不返回上述字段的明文或掩码值以外的内容。

## 执行器与请求协议

新增 `EditorialApiRunner`，其职责只处理标准 JSON + Bearer 协议：

1. 首个需要会话的步骤调用 `/api/auth/login`，并使用本地 TOTP 生成器构造 `totp_code`。
2. 从 `access_token` 读取 JWT，仅保存到批次或单次运行的内存 session。
3. 业务步骤请求 `<baseUrl>/api/editorial/<action>`，以 `application/json` 发送 `request.payload`，并带 `Authorization: Bearer <JWT>`。
4. 依据 HTTP 状态码和 JSON 路径断言步骤结果；提取的变量只允许业务 ID、状态等非敏感值。
5. 运行记录保存已脱敏的请求和响应摘要。JWT、账号、密码和动态码不得写入 SQLite、报告、日志或截图。

API 用例的请求结构增加 `protocol` 字段：既有加密用例使用默认 `cms`，新用例使用 `editorial`。`ApiRunner` 路由器根据该字段分派到对应执行器，防止两个协议相互渗透。一个批量执行只允许同一协议的 API 用例，以保证单一可复用会话语义。

## 用例集合

在“方舟AI评论审核”项目写入以下固定 ID 用例，重复执行时覆盖同 ID 的用例定义：

| 用例 | 步骤 | 副作用 |
| --- | --- | --- |
| AI 评论概览查询 | summary、configs、records | 无 |
| AI 评论审核列表查询 | list（AI 来源）、stats | 无 |
| AI 评论人工通过闭环 | 查询 manual_review、选择未占用 ID、approve、按 ID 回查 | 修改一条待审核记录 |
| AI 评论人工驳回闭环 | 查询 manual_review、选择未占用 ID、reject、按 ID 回查 | 修改一条待审核记录 |

通过和驳回用例标为 `mutating`，必须由平台请求中的 `allowMutations: true` 显式授权。批量运行共享 `selectedApiIds`，同一个审核记录不会被两个用例重复选中。没有可用 `manual_review` 记录时，执行状态为 `skipped`，报告保留查询证据和“前置数据不足”原因。

## 错误处理与报告

- 登录失败、缺失 Token、401、403、非 JSON 响应以及 JSON 断言失败均使当前步骤失败，并保存脱敏的请求/响应证据。
- 读取 `manual_review` 为空属于前置条件不足，标记跳过，不重试成写操作。
- 通过或驳回响应即使部分同步失败，也必须断言 `synced` 包含选中的 ID；否则失败并记录响应摘要。
- 回查必须断言目标状态、`review_reason` 存在且 `reviewed_at` 存在。

## 验证

单元测试使用模拟登录和业务响应，验证 TOTP 传递、JWT 仅在内存复用、请求头、敏感字段脱敏、协议路由、重复选择规避以及前置条件跳过。集成验证使用测试账号登录真实服务，执行两组只读用例；只有在明确传入写授权时才执行通过/驳回闭环，并检查平台报告中不含敏感值。
