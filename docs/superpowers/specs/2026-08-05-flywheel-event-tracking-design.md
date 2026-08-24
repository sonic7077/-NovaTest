# 飞轮埋点接口用例设计

## 目标

在“飞轮引擎”项目中补充可执行的用户行为埋点接口用例，使用中文命名、项目专属测试数据和现有飞轮 API 执行器，验证 `POST /api/v1/feedback` 的事件上报契约。

## 范围

新增以下正例资产：

- 飞轮信息流曝光上报（`impression`）。
- 飞轮有效阅读上报（`read`，带 `dwell_ms`、`completion`）。
- 飞轮点赞上报（`like`）。
- 飞轮收藏上报（`favorite`）。
- 飞轮不感兴趣上报（`dislike`）。
- 飞轮快速划走上报（`skip`，带小于 3000 的 `dwell_ms`）。
- 飞轮搜索结果点击上报（`search_click`）。

`GET /api/v1/search` 自带搜索行为记录，因此不创建独立的 `search` 事件上报资产。`read_complete`、`meh`、`unlike`、`unfavorite` 也不创建：前两者是引擎派生事件，后两者当前不会回撤推荐信号。

## 数据与执行流程

每条事件用例独立运行，避免依赖其他测试运行：

1. 使用 `{{platformId}}-novatest-{{runId}}` 创建文本内容并提取 `jobId`。
2. 轮询采集状态，最多 20 次、每次间隔 1 秒；状态达到 `done` 或 `dup` 后提取 `contentId`。
3. `impression`、`read`、`like`、`favorite`、`dislike`、`skip` 使用该 `contentId` 调用 `/api/v1/feedback`。
4. `search_click` 先以同一用户和唯一关键词调用 `/api/v1/search`；只有找到当前内容时才提取结果 ID 并上报点击。搜索无结果时用例标记为“前置数据不足”，报告保存搜索响应证据。

所有写入步骤标记 `mutating`，运行入口必须显式传入 `allowMutations: true`。资产保持可执行，不默认禁用。

## 事件断言

| 用例 | event | payload | 预期 |
| --- | --- | --- | --- |
| 信息流曝光上报 | `impression` | `{ position: 0 }` | `200` 且 `$.ok === true` |
| 有效阅读上报 | `read` | `{ dwell_ms: 8000, completion: 0.9 }` | `200` 且 `$.ok === true` |
| 点赞上报 | `like` | 无 | `200` 且 `$.ok === true` |
| 收藏上报 | `favorite` | 无 | `200` 且 `$.ok === true` |
| 不感兴趣上报 | `dislike` | 无 | `200` 且 `$.ok === true` |
| 快速划走上报 | `skip` | `{ dwell_ms: 1200 }` | `200` 且 `$.ok === true` |
| 搜索结果点击上报 | `search_click` | 无 | `200` 且 `$.ok === true` |

每条请求均带 `user_id`、`content_id`、`session_id` 与 `event`。报告沿用当前脱敏规则：平台密钥绝不进入请求、响应、变量、导出 HTML 或 Git。

## 验证

单元测试验证资产中文名称、事件集合、必填 payload、独立采集前置步骤、写入安全标识，以及不包含派生或取消事件。集成验证在飞轮测试环境运行至少一条带 payload 的埋点用例和一条显式反馈用例，检查任务状态、反馈响应和报告脱敏。完整回归需保持通过。
