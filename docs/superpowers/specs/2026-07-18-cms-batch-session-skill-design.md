# CMS 批量会话与加密 Skill 设计

## 目标

让同一个 API 批量任务中的所有 CMS 用例共享一次 `loginByPassword` 登录结果，并将 CMS 加密请求、响应解密与脱敏流程固化为可复用的 Codex Skill。

## 会话模型

- `CmsApiRunner.createSession()` 返回仅驻留内存的会话对象，初始不含 token。
- `CmsApiRunner.authenticate(baseUrl, session)` 是公共方法，构造加密登录请求、校验业务状态、解密响应，并把 token 保存到 `session.token`。
- `CmsApiRunner.execute()` 对非登录 API 请求调用认证方法后，自动把会话 token 写入加密 payload。用例步骤不需要声明 `loginByPassword` 或 token 变量。
- `RunService.start(testCase, { apiSession })` 接收可选会话；单条接口运行创建临时会话，批量服务向该批次的每个 API 用例传入同一个会话对象。
- 会话 token 不写入 `run.variables`、SQLite、测试报告或 API 证据。现有 `redactSecrets()` 继续对 token、密码、密文和签名脱敏。

## 批量行为

- `BatchService` 为 API 批次创建一个共享会话，并按既有顺序执行用例。
- 首个实际 API 请求触发一次认证，后续所有用例复用 token。
- 认证失败写入会话失败状态。当前用例及之后的 API 用例失败，但不会发起任何业务接口请求。
- 为兼容已有手工用例，显式 `loginByPassword` 步骤会调用同一个公共认证方法；不会重复发出登录请求。
- 白包种子用例移除重复登录步骤，保留配置和业务接口步骤。

## 加密协议

- 请求 payload 采用 AES-128-CBC 加密为 Base64 `data`。
- 表单字段为 `timestamp`、`data`、`sign`；签名为 `MD5(SHA256("data=<data>&timestamp=<timestamp><appKey>"))`。
- 当响应标记为加密时，用相同 AES 配置解密并解析 JSON；兼容 `status` 与白包 `errcode` 成功协议。
- 密钥、IV、appKey、用户名与密码只能从环境变量读取，禁止出现在源代码、测试、Skill、日志、报告或 Git 提交中。

## Skill

- 名称：`cms-encrypted-api`。
- 安装位置：`~/.codex/skills/cms-encrypted-api`。
- 内容：精简 `SKILL.md`、`agents/openai.yaml`，以及不含真实凭证的协议参考文件。
- 触发场景：CMS 加密接口调试、创建 CMS 接口用例、排查加密响应、实现 CMS 认证复用。
- Skill 引导使用环境变量、结构化 API 步骤、JSON 断言、变量提取和脱敏，不直接执行未经授权的写操作。

## 验收标准

- 三条 CMS API 用例的同一批量任务仅请求一次 `loginByPassword`。
- 每个业务请求携带同一个已脱敏的会话 token；运行结果和报告均不保存明文 token。
- 单条 API 调试使用一次临时认证会话。
- 登录失败后不再调用业务接口。
- Skill 通过结构和元数据校验，且不包含任何真实密钥、账号、密码、URL 或 token。
