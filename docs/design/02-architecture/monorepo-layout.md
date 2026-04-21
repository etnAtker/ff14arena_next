# Monorepo 结构

仓库结构如下：

```text
ff14arena_next/
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  apps/
    web/
    server/
  packages/
    core/
    shared/
    content/
  docs/
    design/
```

## 包管理器与运行时

项目统一使用 `pnpm` 作为包管理器。  
项目运行时统一使用 `Node.js`。

根目录 `package.json` 写入 `packageManager` 字段。  
workspace 结构由 `pnpm-workspace.yaml` 管理。  
锁文件统一使用 `pnpm-lock.yaml`。

项目内不引入第二套包管理器配置，不提交 `package-lock.json`、`yarn.lock` 或 `bun.lockb`。

## apps/web

负责浏览器端页面与绘制层。

技术栈：

- Vue 3
- PixiJS
- Pinia
- TypeScript

职责：

- 房间页、战斗页、结算页
- 场地绘制、玩家与 Boss 可视化、机制表现
- 用户输入采集
- 本地镜像状态展示
- Socket.IO 客户端

## apps/server

负责多人房间、权威模拟、鉴权与同步。

技术栈：

- Fastify
- Socket.IO
- TypeScript

职责：

- 房间生命周期管理
- 战斗选择与开练流程
- 权威模拟实例托管
- Bot 托管
- 状态广播与断线重连

## packages/core

负责机制模拟内核。

职责：

- 时间推进
- 空间与碰撞
- Actor 状态
- Boss 行为脚本执行
- 机制 helper
- 血量与死亡
- 事件与快照生成

`core` 必须做到：

- 不依赖 DOM
- 不依赖 HTTP
- 不依赖 Socket.IO
- 不依赖数据库
- 可在浏览器和 Node 中运行

## packages/shared

负责前后端共享协议与类型。

职责：

- 房间 DTO
- Socket 事件类型
- 快照和增量事件结构
- 角色槽位和战斗元数据结构

## packages/content

负责战斗内容与配置内容。

职责：

- 战斗清单
- Boss 和场地图元数据
- 战斗脚本内容
- Bot 时间线脚本
