# Google TOTP 登录与失败证据设计

## 目标

为 `loginByPassword` 请求增加运行时 Google 密钥生成的 TOTP 验证码，使当前项目的登录请求满足后端认证协议；让接口步骤在失败时也保留脱敏的请求与响应证据，便于报告诊断。

## 认证参数

新增必填运行时环境变量 `CMS_GOOGLE_SECRET`。服务启动时将它和现有 CMS 认证字段一并校验，并传入 `CmsApiRunner` 配置。该值是 Base32 编码的 Google Authenticator 密钥，不是将要发送的 `secret` 参数。

执行器仅在 `authenticate()` 调用 `loginByPassword` 时，依据 RFC 6238 生成当前 TOTP：Base32 解码 `CMS_GOOGLE_SECRET`，以 Unix 秒数除以 30 取计数器，使用 HMAC-SHA-1 计算动态截断值，并输出零填充的 6 位数字。该数字作为登录 payload 的 `secret` 字段，与公共客户端参数、账号、密码一起进入既有 AES-CBC 和签名流程。

验证码仅在调用期间驻留内存；不进入环境诊断、运行变量、SQLite、报告、日志或 Git。业务接口不包含 `secret`，也不从用例步骤、变量或 SQLite 读取它。

## 失败证据

`CmsApiRunner.request()` 在 HTTP 或业务状态不符合预期时，构造带 `api` 属性的错误。该属性只包含动作、方法、HTTP 状态、业务状态、耗时、经 `redactTransportSecrets` 处理的请求摘要，以及经 `redactBusinessSecrets` 处理的解包响应。

`RunService` 捕获错误时，将安全的 `error.api` 写入步骤运行记录。这样现有报告服务的 API 证据区可在失败步骤中渲染“请求摘要”和“响应内容”，同时继续显示错误消息。token、密码和 `secret` 必须替换为掩码；登录自身的响应继续整体掩码。

## 错误与会话

认证失败仍写入 session 的安全错误文本，并阻止同一批次后续业务请求。不会把 token、secret 或完整认证响应放入 session 以外的持久化数据。登录成功后 token 仍只保留在共享内存 session。

## 测试与验证

- TOTP 单元测试使用 RFC 6238 的公开向量验证当前验证码计算；不使用任何真实密钥。
- 执行器单元测试验证登录请求解密后含合成的 6 位验证码，而业务请求没有该字段。
- 执行器单元测试验证业务状态失败的错误带脱敏 API 证据。
- 运行服务测试验证失败步骤持久化 API 证据。
- 报告测试验证失败 API 步骤展示请求与响应区，且不含合成 token、密码或 secret。
- 真实只读登录验证仅输出状态、动作和报告证据存在性，不输出任何凭据、Google 密钥、验证码、token、密文、签名或正文。
