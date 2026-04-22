# 部署说明

本文档说明当前仓库的推荐部署方式。

当前推荐生产部署形态为：

- 一个 Docker 镜像
- 一个 Node.js 进程
- 一个对外端口
- 同时承载前端页面、HTTP API 和 Socket.IO

## 1. 部署结构

当前生产结构如下：

- `apps/web` 使用 Vite 构建为静态资源
- `apps/server` 使用 Fastify 承载 API、Socket.IO 和静态资源托管
- 浏览器通过同一个 origin 访问页面、接口和实时连接

这意味着生产环境不再需要把前端和后端拆成两个域名或两个端口。

## 2. 开发与生产的区别

当前开发环境仍保持双端口：

- `apps/web` 由 Vite Dev Server 提供页面
- `apps/server` 提供 API 和 Socket.IO
- Vite 通过代理把 `/health`、`/battles`、`/rooms` 和 `/socket.io` 转发到服务端

当前生产环境改为单端口：

- 服务端直接托管前端构建产物
- `/health`、`/battles`、`/rooms` 继续作为后端接口
- `/socket.io` 继续作为实时通信入口
- 其余页面请求统一回退到前端入口 `index.html`

## 3. SPA 回退规则

服务端只会对以下请求执行 SPA 回退：

- 请求方法为 `GET` 或 `HEAD`
- 请求头声明可接受 `text/html`
- 路径不属于后端接口或 Socket.IO 前缀

因此：

- 浏览器直接访问前端路由时会返回前端页面入口
- API 错误路径不会被错误回退成 HTML 页面

## 4. Docker 构建与运行

在仓库根目录执行：

```bash
docker build -t ghcr.io/etnatker/ff14arena:latest .
```

运行方式：

```bash
docker run --rm -p 3000:3000 ghcr.io/etnatker/ff14arena:latest
```

也可以直接使用仓库根目录下的 Compose 配置：

```bash
docker compose up -d
```

对应文件：

- [docker-compose.yml](/home/etnatker/workspace/code/ff14arena_next/docker-compose.yml)

容器默认环境变量：

- `PORT=3000`
- `WEB_DIST_DIR=/app/public`
- `NODE_ENV=production`

## 5. GitHub Actions 发布

仓库提供手动触发的 GitHub Actions workflow：

- 文件：`.github/workflows/docker-publish.yml`
- 触发方式：`workflow_dispatch`
- 推送目标：`ghcr.io/etnatker/ff14arena:latest`

该 workflow 使用仓库自带的 `GITHUB_TOKEN` 登录 GHCR。  
执行前需要确保当前仓库具备向 `ghcr.io/etnatker/ff14arena` 发布包的权限。

## 6. 当前部署限制

当前房间和战斗状态仍保存在服务端内存中。

这意味着当前部署默认是单实例权威运行模型，暂不适合直接做无状态横向扩容。  
若后续需要多实例部署，需要先补齐以下能力：

- 房间归属与连接粘性策略
- 外部状态存储或权威房间调度
- 断线重连与实例迁移策略
