# 服务端运行与同步

本文档描述 `apps/server` 当前的房间托管、HTTP 接口与实时同步实现。

相关代码入口：

- [apps/server/src/app.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/app.ts)
- [apps/server/src/room-manager.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/room-manager.ts)
- [apps/server/src/room-record.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/room-record.ts)
- [apps/server/src/room-presenter.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/room-presenter.ts)
- [apps/server/src/metrics.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/metrics.ts)
- [packages/shared/src/index.ts](/home/etnatker/workspace/code/ff14arena_next/packages/shared/src/index.ts)

## 1. 房间托管职责

当前服务端负责以下职责：

- 创建与销毁房间
- 管理房主、玩家与 Bot 槽位
- 管理房间观战成员
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
- `GET /admin/metrics`

这些接口用于存活探测、战斗列表查询、静态战斗信息获取、房间创建和短期性能观测。

## 3. 房间生命周期

当前房间主链路如下：

1. 房主通过 `POST /rooms` 创建房间并立即加入
2. 其他玩家通过 Socket 加入房间
3. 房主选择 battle，空槽自动补 Bot，并建立等待态权威模拟
4. 房主开始战斗，服务端把同一个权威模拟切入 `running`
5. 模拟结束后，服务端重建等待态权威模拟并保留上一轮结果

`waiting` 阶段中，槽位玩家可以切换为观战成员。
切换观战后，原槽位立即由 Bot 接管，玩家仍保留在 Socket 房间内并继续接收房间状态、快照和事件。
观战成员点击可用槽位后会回到场内，目标槽位由该玩家接管。

房主可以在观战状态开始战斗。
开始战斗仍要求所有非房主真人成员已准备；成员包括占槽玩家和观战玩家。
当 8 个战斗槽位全部为 Bot 时，只要房间内真人成员满足准备条件，服务端允许开始战斗。

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
  - 切换观战
  - 准备
  - 开始
  - 重开
- 连续覆盖型输入：
  - `sim:input-frame`
- 一次性指令：
  - `sim:use-knockback-immune`
- 主动重同步请求：
  - `sim:request-resync`

当前连续覆盖型输入统一通过 `sim:input-frame` 发送。  
该输入帧当前携带：

- `inputSeq`
- `issuedAt`
- `payload.position`
- `payload.facing`
- `payload.moveDirection`

### 当前下行事件

- `room:state`
  同步当前房间状态
- `room:slots`
  同步当前槽位状态
- `sim:start`
  下发一轮新同步流的起始快照
- `sim:events`
  下发当前同步流中的增量事件
- `sim:snapshot`
  下发 join / rejoin / resync 快照以及周期性权威快照

当前 `sim:start`、`sim:events` 和 `sim:snapshot` 都会携带 `syncId`。

## 5. 权威同步行为

当前服务端同步行为如下：

- `packages/core` 消费输入并推进权威状态
- 服务端在等待态与运行态都按房间 Tick 驱动权威模拟
- 服务端按房间 Tick 广播增量事件
- 服务端按当前策略下发周期性权威快照与必要的重同步快照
- 客户端请求重同步时，服务端会向该连接回送当前权威快照、房间状态和槽位状态

当前同步模型中：

- 玩家普通移动由客户端本地模拟，并以上传位姿样本的方式同步给服务端
- 服务端按 `actorId + inputSeq` 去重，只保留每个 Actor 最新的位姿样本
- 服务端在每个房间 Tick 开始时先收集玩家与 Bot 的统一控制帧，再推进 `packages/core`
- `waiting` 与 `running` 永远共用同一套移动链路，不维护独立实现
- `running` 只是比 `waiting` 多推进战斗脚本、AOE、伤害、Buff 与结算
- Bot controller 运行在 `core` 外部，只读取快照与 `scriptState`，再向 `core` 提交统一控制帧
- 普通移动不再做 `issuedAtServerTimeEstimate` 时间补偿，也不再回传输入确认序号
- 击退、越界修正等强修正仍通过事件直接下发位置结果

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

## 7. 性能观测

当前服务端提供内存态短期性能观测能力，观测接口为 `GET /admin/metrics`。

观测实现遵循以下约束：

- 指标只保存在当前 Node.js 进程内存中，服务重启后清空
- 不落盘，不写数据库，不生成指标日志文件
- 默认观测最近 `10` 分钟滑动窗口数据
- 每 `10` 秒一个聚合 bucket
- 默认指标内存设计预算估算为 `16 MB`
- 指标内存设计上界估算为 `32 MB`
- 房间级指标最多跟踪 `256` 个房间
- 已关闭房间指标最多短期保留 `64` 个
- 超出房间指标上限时，优先丢弃已关闭或最久未活跃房间的指标
- 实际强约束是窗口 bucket 数、活跃房间指标数和已关闭房间指标数，不做 JS 对象字节级硬限制
- `/health` 和 `/admin/metrics` 请求不会进入 HTTP 路由性能统计

观测数据只记录计数、耗时直方图和房间运行摘要。  
服务端不会记录以下内容：

- HTTP 请求 body
- Socket payload
- 玩家输入明细
- 完整 `SimulationSnapshot`
- 完整 `SimulationEvent`
- 战斗日志正文
- 玩家名称历史

当前观测指标覆盖：

- Node.js 进程 uptime、内存、事件循环延迟和事件循环利用率
- HTTP 路由请求数、错误率、耗时 p95 和最大耗时
- Socket.IO 当前连接数、累计连接断开数、上行事件数、下行事件数和错误码分布
- 房间总数、等待态房间数、运行中房间数、活跃模拟数、在线玩家数和 Bot 数
- Tick 总耗时、Bot controller 耗时、core simulation tick 耗时和 Tick 超时次数
- 输入帧数量、丢弃旧输入数量、Bot 控制帧数量、模拟事件数量、快照数量和重同步请求数量

耗时 p95 使用固定直方图近似计算，不保存原始耗时样本。  
当前直方图包含亚毫秒桶，因此轻负载下的 Tick p95 不会统一显示为 `1ms`。  
每次读取 `/admin/metrics` 时，服务端会以当前时间所在 bucket 为终点，合并最近 `60` 个 `10` 秒 bucket。

Bot 指标单独从 Tick 指标中拆出。  
Bot 不占用 Socket 连接，也不产生客户端上行 `sim:input-frame`，但 Bot controller 和 Bot 控制帧会占用服务端 Tick 预算，并间接影响模拟事件数量、快照序列化成本、CPU 使用和事件循环延迟。
