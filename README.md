# FF14 Arena Next

FF14 Arena Next 是一个多人联机机制模拟项目，用于在 Web 中模拟 FF14 副本机制练习流程。

当前项目处于原型阶段，已打通房间创建、玩家加入、战斗选择、Bot 补位、服务端权威模拟、客户端同步与战斗结算等基础链路。

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

## 部署

生产部署推荐使用一个 Docker 镜像、一个 Node.js 进程和一个对外端口，同时承载前端页面、HTTP API 和 Socket.IO。

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
