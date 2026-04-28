# FF14 Arena Next

FF14 Arena Next 是一个多人联机机制模拟项目，用于在 Web 中模拟 FF14 副本机制练习流程。

当前项目处于原型阶段，已打通房间创建、玩家加入、战斗选择、Bot 补位、服务端权威模拟、客户端同步与战斗结算等基础链路。

## 项目结构

当前仓库采用 pnpm workspace 管理前端、后端和共享包：

- `apps/web`：Web 客户端，负责页面、交互、PixiJS 战斗画布、HUD、输入采集和客户端同步展示。
- `apps/server`：Node.js 服务端，负责房间生命周期、HTTP API、Socket.IO 实时同步、Bot 补位和权威模拟托管。
- `packages/core`：战斗模拟内核，负责 Tick 推进、移动、碰撞、机制 primitive、伤害、状态和快照事件生成。
- `packages/shared`：前后端共享协议与类型，包含房间 DTO、Socket 事件、快照、增量事件和战斗元数据结构。
- `packages/content`：战斗内容层，存放战斗清单、场地与 Boss 元数据、战斗脚本、Bot 跑法和机制判定细节。

前端和服务端共享同一套 `core` 与 `shared`。战斗规则只放在 `packages/core` 和 `packages/content` 的边界内，`apps/web` 只负责展示和交互，`apps/server` 只负责房间、同步和权威模拟托管。

## 启动

环境要求：

- Node.js >= 20.19.0
- pnpm

安装依赖：

```bash
pnpm install
```

启动开发环境：

```bash
pnpm dev
```

开发环境会同时启动共享包监听、服务端和 Web 客户端。

开发服务器端口：

- Web 客户端：`http://127.0.0.1:5173`
- 服务端 API 与 Socket.IO：`http://127.0.0.1:3000`

开发环境中，Vite Dev Server 会把 `/health`、`/battles`、`/rooms`、`/admin` 和 `/socket.io` 代理到服务端。

## 部署

生产部署推荐使用一个 Docker 镜像、一个 Node.js 进程和一个对外端口，同时承载前端页面、HTTP API 和 Socket.IO。

生产部署结构：

- `apps/web` 先构建为静态资源。
- `apps/server` 构建为 Node.js 服务，并在运行时托管前端静态资源。
- 容器默认监听 `3000` 端口，对外同时提供页面、HTTP API、Socket.IO 和后端观测接口。
- 浏览器通过同一个 origin 访问前端页面、后端接口和实时连接。

构建镜像：

```bash
docker build -t ghcr.io/etnatker/ff14arena:latest .
```

运行容器：

```bash
docker run --rm -p 3000:3000 ghcr.io/etnatker/ff14arena:latest
```

也可以使用 Docker Compose：

```bash
docker compose up -d
```

完整部署说明见 [docs/implementation/deployment.md](./docs/implementation/deployment.md)。

## 文档指引

- [文档索引](./docs/README.md)
- [当前实现](./docs/implementation/README.md)
- [设计文档](./docs/design/README.md)
- [待办事项](./docs/todo/README.md)
