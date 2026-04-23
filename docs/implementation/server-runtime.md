# 服务端运行与同步

本文档描述 `apps/server` 当前的房间托管、HTTP 接口与实时同步实现。

相关代码入口：

- [apps/server/src/app.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/app.ts)
- [apps/server/src/room-manager.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/room-manager.ts)
- [packages/shared/src/index.ts](/home/etnatker/workspace/code/ff14arena_next/packages/shared/src/index.ts)

## 1. 房间托管职责

当前服务端负责以下职责：

- 创建与销毁房间
- 管理房主、玩家与 Bot 槽位
- 维护等待态与运行态房间数据
- 托管权威模拟实例
- 对客户端广播快照与增量事件
- 处理断线重连与主动重同步

战斗规则本身仍由 `packages/core` 提供，服务端不维护第二套战斗规则。

## 2. HTTP 接口

当前服务端暴露以下 HTTP 接口：

- `GET /health`
- `GET /battles`
- `GET /battles/:battleId/static`
- `GET /rooms`
- `POST /rooms`

这些接口用于存活探测、战斗列表查询、静态战斗信息获取和房间创建。

## 3. 房间生命周期

当前房间主链路如下：

1. 房主通过 `POST /rooms` 创建房间并立即加入
2. 其他玩家通过 Socket 加入房间
3. 房主选择 battle，空槽自动补 Bot，并建立等待态权威模拟
4. 房主开始战斗，服务端把同一个权威模拟切入 `running`
5. 模拟结束后，服务端重建等待态权威模拟并保留上一轮结果

运行中若连接断开，原玩家槽位不会立即被其他连接顶替。  
同一玩家重新加入房间后，服务端会尝试恢复其原槽位，并下发当前权威快照。

## 4. 实时同步

当前实时同步基于 Socket.IO，协议定义位于：

- [packages/shared/src/index.ts](/home/etnatker/workspace/code/ff14arena_next/packages/shared/src/index.ts)

### 当前上行事件

- 房间操作事件：
  - 加入房间
  - 离开房间
  - 切换槽位
  - 准备
  - 开始
  - 重开
- 连续覆盖型输入：
  - `sim:input-frame`
- 一次性指令：
  - `sim:use-knockback-immunity`
- 主动重同步请求：
  - `sim:request-resync`

当前连续覆盖型输入统一通过 `sim:input-frame` 发送。  
该输入帧可同时携带移动方向、可选朝向、`inputSeq`、`issuedAt` 和可选 `issuedAtServerTimeEstimate`。

### 当前下行事件

- `room:update`
  同步当前房间、成员和槽位状态
- `sim:start`
  下发一轮新同步流的起始快照
- `sim:events`
  下发运行中的增量事件
- `sim:snapshot`
  下发等待态快照、周期性运行态快照和重同步快照

当前 `sim:start`、`sim:events` 和 `sim:snapshot` 都会携带 `syncId`。  
服务端在 `sim:events` 与 `sim:snapshot` 中回传 `acknowledgedInputSeq`，用于告知客户端已经处理到的连续输入序号。

## 5. 权威同步行为

当前服务端同步行为如下：

- `packages/core` 消费输入并推进权威状态
- 服务端按房间 Tick 广播运行中的增量事件
- 服务端按当前策略下发等待态快照、周期性运行态快照和必要的重同步快照
- 客户端请求重同步时，服务端会向该连接回送当前权威快照、房间状态和槽位状态

当前同步模型中：

- 位置与状态以服务端权威结果为准
- `acknowledgedInputSeq` 只表示服务端已处理到的连续输入序号
- 服务端会把 `issuedAtServerTimeEstimate` 从墙钟时间换算到当前权威模拟时间轴
- `packages/core` 会保留最近一小段移动历史，并在新移动输入到达时按估计生效时刻补算当前位置
- 等待态与运行态共用同一个 `SimulationInstance` 接口和同一套移动规则，不再维护独立的等待态移动实现
- 服务端不会采纳客户端上报的绝对坐标作为权威位置
- 击退、越界修正等强位移会直接发硬修正位置事件

## 6. 当前边界

当前服务端仍是单进程内存态房间模型。  
当前部署下不包含：

- 外部房间状态存储
- 多实例房间调度
- 实例间迁移
- 持久化回放归档

更长期的部署与扩展方向请同时参考：

- [部署说明](./deployment.md)
- [docs/todo/README.md](/home/etnatker/workspace/code/ff14arena_next/docs/todo/README.md)
