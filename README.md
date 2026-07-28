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

## 部署数据包

测试完成后创建数据包：

```bash
npm run package:data
```

该命令只生成 `artifacts/novatest-data-<timestamp>.tar.gz`。归档中仅包含：

- `data/novatest.db`
- `manifest.json`（数据库 SHA-256）

将归档传到测试服务器后，在项目目录解压：

```bash
tar -xzf novatest-data-<timestamp>.tar.gz
```

随后按正常 Git 流程发布代码，并启动服务：

```bash
docker compose -f docker-compose.deploy.yml up -d --build
```

服务固定绑定 `127.0.0.1:18084`，由主机 Nginx 反向代理。数据包包含测试环境凭据，应仅保存在受控测试服务器和受控传输渠道中，不能提交到 Git。
