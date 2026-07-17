# CMS 加密接口测试适配设计

## 目标

将 51吃瓜白包测试环境接入测试平台，使接口测试资产可自动完成 CMS 加密请求、响应解密、登录令牌传递、结构化断言和运行报告，并基于社区帖子、评论、用户信息审核文档生成初始接口用例。

## 环境与密钥

环境名为“51吃瓜白包测试”，根地址为文档所列白包测试地址。以下值只从本地 .env 读取，禁止保存到 SQLite、接口用例 JSON、报告或前端：

- CMS 基础地址
- CMS AES key / IV / app key
- CMS 管理员用户名 / 密码
- oauth_id、oauth_type、version、bundleId、language、via

请求采用 AES-128-CBC，流程为：规范化 JSON -> AES-CBC 加密并 Base64 -> 使用 timestamp、密文和 app key 生成文档定义的签名 -> form-urlencoded 提交。响应的 crypt 标记为真时解密 data，再进行断言和变量提取。

## API 用例模型

API 用例独立于 Web UI 编排器，target 为 api。步骤包含 method、action、payload、expectedStatus、expectedJson、extract 和 safety：

- action 拼接为 /api.php/api/remote/<action>。
- payload 支持 {{variable}} 插值。
- expectedStatus 断言 HTTP 状态和业务 status。
- expectedJson 使用路径和值断言解密后的 data。
- extract 从 data 中写入 token、帖子 ID 等变量。
- safety 是 readonly 或 mutating；mutating 用例默认禁用，只有运行请求显式 allowMutations 才能执行。

登录用例将 token 写入运行变量，后续步骤由 Runner 自动合并 token 和公共参数。

## 执行器与报告

新增 CmsApiRunner，负责构造加密请求、发送、解密、断言和提取。API 运行步骤记录请求 action、脱敏后的请求参数、HTTP 状态、业务 status、耗时、响应摘要、断言结果和错误；不记录明文密码、token、密钥、IV、app key 或完整加密载荷。

工作台增加 Web UI / 接口测试类型切换，接口测试展示当前运行、请求数量、成功率、平均响应耗时和最近步骤过程。报告按步骤显示 action、请求方法、断言、响应摘要及解密/签名错误。

## 初始用例库

根据文档先导入 3 组只读冒烟用例：

1. 登录并获取 token。
2. 登录 -> config -> list_post(status=10)。
3. 登录 -> config -> list_post_comments(status=0) -> list_member_update_log(status=10)。

创建、更新、删除、审核、回复和批量刷评论类接口作为第二批 mutating 用例导入，但默认 disabled，执行时必须显式允许写操作。

## 安全与验收

- 运行前缺少任一 CMS 环境变量时返回明确配置错误。
- 所有密钥和账户信息在 API 响应、日志、报告、SQLite 和前端中均不可见。
- 解密、签名、token 自动注入、变量提取和业务断言均有单元测试。
- 初始只读用例保存到本地测试资产，能在白包测试环境调试。
- 写操作用例未显式 allowMutations 时不得发送请求。

