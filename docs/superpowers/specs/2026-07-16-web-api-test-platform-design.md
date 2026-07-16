# Web 与 API 智能测试平台设计

## 目标

将现有用例编排界面扩展为本地可运行的自动化测试 MVP：通过自然语言执行 Web UI 测试和接口测试，并生成带步骤证据的报告。

## 范围

本阶段仅支持 Web UI 和 API 服务。Android、ADB 和移动原生应用执行器不在范围内。移动 H5 通过 Web UI 执行器的 `mobile` 视口配置运行，不作为独立执行器。

## 架构

前端调用本地 HTTP 服务创建执行任务并轮询任务状态。服务按用例目标选择 `WebRunner` 或 `ApiRunner`，将每一步的事件写入任务记录。报告服务聚合任务、步骤、截图和变量，生成 JSON 报告与 HTML 报告。

```text
Web Console -> HTTP API -> ExecutionService -> WebRunner (Playwright + Midscene)
                                      |-> ApiRunner (HTTP client)
                                      |-> ReportService -> JSON / HTML report
```

执行状态和用例采用本地文件持久化；执行队列在单进程内运行。该 MVP 不引入数据库、消息队列、账户系统或定时任务。

## 用例模型

```ts
type Target = 'web' | 'api';
type WebViewport = 'desktop' | 'mobile';
type StepKind = 'action' | 'assert' | 'query' | 'apiRequest';

interface TestStep {
  id: string;
  kind: StepKind;
  instruction: string;
  request?: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
    expectedStatus?: number;
    expectedJson?: Record<string, unknown>;
  };
}

interface TestCase {
  id: string;
  name: string;
  target: Target;
  baseUrl: string;
  viewport?: WebViewport;
  steps: TestStep[];
}
```

`query` 会将模型提取的 JSON 对象合并为运行时变量。后续步骤中的 `{{name}}` 会由变量值替换。未定义变量应在该步骤开始前失败，且不再运行后续步骤。

## Web UI 执行器

`WebRunner` 创建 Playwright 浏览器上下文：`desktop` 使用 1440x900，`mobile` 使用 390x844。它依赖可注入的 Midscene 适配器，以便在单元测试中使用假实现而不调用模型服务。

步骤映射：

- `action` 调用 Midscene `aiAct`。
- `assert` 调用 Midscene `aiAssert`。
- `query` 调用 Midscene `aiQuery`，并将返回对象写入变量。

每一步完成或失败后都保存截图。单步失败时仅重试一次；重试仍失败则结束任务。启动 Web UI 任务前必须存在 `MIDSCENE_MODEL_BASE_URL`、`MIDSCENE_MODEL_API_KEY`、`MIDSCENE_MODEL_NAME` 和 `MIDSCENE_MODEL_FAMILY`，否则任务以明确配置错误结束。

## API 执行器

`ApiRunner` 只运行含 `request` 配置的 `apiRequest` 步骤。它执行 HTTP 请求，验证预期状态码和 JSON 字段值，并将响应 JSON 置为 `response` 变量。请求 URL、请求体和请求头也支持 `{{name}}` 变量替换。

自然语言仅用于报告展示，不会被转换为接口请求。这样可以避免模型产生未审查的写操作。

## 报告与前端

每次执行创建一个唯一 run id。任务状态为 `queued`、`running`、`passed` 或 `failed`。前端每秒读取状态，展示事件时间线与进度。

报告包括：总状态、开始和结束时间、总耗时、每个步骤的状态和耗时、执行日志、截图路径、提取变量以及失败信息。HTML 报告在浏览器中可阅读，JSON 报告可被 CI 或其他系统解析。

现有界面中的 Android 目标替换为 Web UI，H5 作为桌面与移动端视口选择。API 目标保留，并显示其服务地址配置。

## 错误处理

- 用例校验失败：返回 HTTP 400，不创建任务。
- 未配置 Midscene 环境变量：Web 任务标记失败，错误说明缺失变量名。
- Web 步骤失败：记录错误和截图，最多重试一次，再结束任务。
- API 请求异常或断言失败：记录请求概要、响应状态与错误，结束任务。
- 变量不存在：当前步骤失败，错误包含变量名和步骤 id。

## 测试与验收

采用测试驱动开发。单元测试覆盖：用例校验、变量替换、执行器路由、Web 重试、API 状态码和 JSON 断言、报告聚合。测试中的 Web 与模型适配器必须是可控的假实现。

验收条件：

1. 可创建 Web desktop、Web mobile 和 API 用例。
2. Web 用例会通过 Playwright 与 Midscene 适配器执行 `action`、`assert`、`query`。
3. API 用例可执行显式 HTTP 配置和断言。
4. 运行中前端可查看日志和进度，完成后可查看 JSON 与 HTML 报告。
5. 单元测试和构建命令均成功退出。
