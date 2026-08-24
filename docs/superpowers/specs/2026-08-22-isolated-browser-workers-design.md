# 独立浏览器 Worker 设计

## 目标

为 Web UI 批量测试增加独立浏览器 Worker。每个 Worker 绑定一个测试账号，使用独立浏览器上下文完成登录、发布任务、发送文本和上传图片，并将每个用户结果汇总到同一批次报告。

## 约束

- 复用现有 `createWebRunner`、`RunService` 和证据记录格式。
- 不改变单用例执行和 API 批量执行语义。
- Worker 失败只标记该 Worker 的用例失败，其他 Worker 继续执行。
- 每个 Worker 必须有独立上下文、页面、登录状态和证据目录。
- 批次完成时必须释放所有页面、上下文和浏览器句柄。
- 并发度由请求参数控制，默认等于 Worker 数量，最大值受配置限制。

## 方案

新增 `isolated-browser-worker-pool` 模块。模块接收浏览器适配器和 Worker 任务，调用适配器的 `newContext` 工厂创建隔离上下文，再为每个任务建立页面会话。Worker 任务内部复用现有 Web runner 的步骤执行能力，执行结束后通过 `finally` 关闭会话。

浏览器适配器支持两种实现：

1. 生产实现由 Playwright browser 提供 `newContext()`，上下文内通过 `newPage()` 创建页面。
2. 测试实现提供相同接口，使用可跟踪的 fake context 验证隔离和清理。

Worker 池使用有限并发调度器。每个任务返回 `{ workerId, account, status, runIds, messageCount, image, startedAt, finishedAt, error }`。池返回汇总对象，包含 `total`, `passed`, `failed`, `timedOut`, `messageCount`, `imagePassed`、`workers` 和 `durationMs`。

## 数据流

1. 批量请求解析账号列表、任务用例、图片路径和 `workerCount`。
2. 为每个账号创建一个 Worker 任务；不复用账号上下文。
3. Worker 创建 context -> page -> 登录 -> 按步骤执行 -> 记录截图/上传校验 -> 关闭 page/context。
4. 池等待全部 Worker 完成，实时回调 `onWorkerUpdate` 保存执行中心动态状态。
5. 批次服务将 Worker 汇总附加到 batch 和 report，不改变原有 run 记录。

## 错误处理

- 登录失败、页面操作失败、上传失败均归属当前 Worker。
- Worker 超过 `workerTimeoutMs` 后标记 `timedOut`，执行清理；超时不取消其他 Worker。
- context 创建失败按 Worker 失败处理。
- 清理错误写入 `cleanupError`，不覆盖原始失败原因。

## 验证

- 单元测试验证每个 Worker 创建不同 context。
- 单元测试验证并发上限，不超过 `workerCount`。
- 单元测试验证一个 Worker 失败时其他 Worker 仍完成。
- 单元测试验证超时与 finally 清理。
- 回归执行现有测试套件。
