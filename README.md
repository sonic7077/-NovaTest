# 先锋营自动化测试平台

平台的 Web UI、CMS 接口和灯塔登录运行配置统一保存在 `data/novatest.db`。代码通过正常的 Git 提交与部署流程发布；部署数据仅通过独立的 SQLite 数据包交付。

## 首次初始化

在受控的本地环境中准备 `.env` 后，执行一次导入：

```bash
npm run config:bootstrap
```

导入成功后，日常启动不读取模型、CMS 或灯塔相关环境变量：

```bash
npm start
```

模型连接仍可在平台的“AI 模型配置”页面编辑；CMS 与灯塔配置不提供额外界面，避免产生多套配置来源。

## 执行超时

平台会保护每个执行任务，避免模型调用、浏览器操作或接口请求长期不返回。默认 Web UI 单步骤最多 120 秒、接口单步骤最多 30 秒、单条用例最多 10 分钟。超时会记录失败原因并释放执行会话；批量任务会继续执行后续用例。部署时可在 `.env` 中按毫秒覆盖：

```bash
NOVATEST_WEB_STEP_TIMEOUT_MS=120000
NOVATEST_API_STEP_TIMEOUT_MS=30000
NOVATEST_CASE_TIMEOUT_MS=600000
```

配置必须为正数；未配置或配置无效时使用上述默认值。

## 受控性能测试

“性能测试”模块使用本机安装的 [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) 执行一日女友的登录、浏览、浏览记录和点赞混合场景。服务端会直接调用 `k6`；如路径不同，可在部署进程中设置 `K6_BIN`。k6 缺失时任务会明确失败，不会降级为 Node 并发请求。

执行前必须满足以下条件：

- 仅使用测试环境、预置账号池和专用测试帖子，不得使用真实用户、生产环境或运行时注册账号。
- 在“性能测试”中新建场景，选择对应项目的账号池，填写专用帖子与浏览记录内容 ID。
- 账号池数量必须不少于峰值 100 VU；平台仅展示池名称与数量，账号密码只保存在受控 SQLite 中。
- 固定执行阶段为 20 VU/3 分钟、50 VU/5 分钟、100 VU/5 分钟、20 VU/2 分钟。执行中心可查看聚合指标、停止任务和打开 HTML 报告。
- 匿名点赞只可作为一次性专用探针，不能混入持续压测流量；任意异常结论都应结合服务端监控与测试数据清理记录处理。

## 部署数据包

测试完成后创建数据包：

```bash
npm run package:data
```

该命令只生成 `artifacts/novatest-data-<timestamp>.tar.gz`。归档中仅包含：

- `data/novatest.db`
- `manifest.json`（数据库 SHA-256）
- `README.md`（恢复与校验说明）

将归档传到测试服务器后，在项目目录解压：

```bash
tar -xzf novatest-data-<timestamp>.tar.gz
```

随后按正常 Git 流程发布代码，并启动服务：

```bash
docker compose -f docker-compose.deploy.yml up -d --build
```

服务固定绑定 `127.0.0.1:18084`，由主机 Nginx 反向代理。数据包包含测试环境凭据，应仅保存在受控测试服务器和受控传输渠道中，不能提交到 Git。
