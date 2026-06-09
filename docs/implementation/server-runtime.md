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
- `GET /auth-config`
- `GET /battles`
- `GET /battles/:battleId/static`
- `GET /rooms`
- `POST /rooms`
- `GET /admin/metrics`

这些接口用于存活探测、战斗列表查询、静态战斗信息获取、房间创建和短期性能观测。

`GET /auth-config` 只返回当前是否启用房间密码，不返回密码内容。
服务端启动时读取一次运行时环境变量 `ROOM_PASSWORD`。
该变量未设置或为空字符串时，创建和加入房间不要求密码；该变量非空时，`POST /rooms` 和 Socket `room:join` 都必须携带匹配密码。
密码校验覆盖创建房间、普通加入、加入观战和断线重连。

`GET /battles/:battleId/static` 返回战斗静态数据，包括地图标点、初始站位和该战斗可展示的状态元数据。状态元数据包含 XIVAPI 名称、描述、图标路径、前端图标 URL、兜底文字和 `PartyListPriority`。

`POST /rooms` 当前只创建建房申请，不立即实例化真实房间。
响应返回 `roomId` 和 `expiresAt`。
建房申请不会出现在 `GET /rooms` 房间列表和服务端房间指标中。
房主必须在 `30s` 内通过 Socket `room:join` 消费该申请；消费成功后服务端才创建真实房间、让房主占用战斗槽位并广播等待态房间状态。
超时未消费的建房申请会自动过期。

## 3. 房间生命周期

当前房间主链路如下：

1. 房主通过 `POST /rooms` 创建建房申请
2. 房主通过 Socket `room:join` 消费建房申请，服务端实例化真实房间并让房主加入
3. 其他玩家通过 Socket 加入房间或直接加入观战
4. 房主选择 battle，空槽自动补 Bot，并建立等待态权威模拟
5. 房主开始倒计时，倒计时结束后服务端把同一个权威模拟切入 `running`
6. 运行中房主可以快速失败，服务端立即把本轮结果结算为失败并回到等待态
7. 模拟结束后，服务端重建等待态权威模拟并保留上一轮结果

`waiting` 阶段中，槽位玩家可以切换为观战成员。
切换观战后，原槽位立即由 Bot 接管，玩家仍保留在 Socket 房间内并继续接收房间状态、快照和事件。
玩家也可以从大厅直接加入观战，直接观战不占用 8 个战斗槽位，槽位满员时仍允许加入。
观战成员点击可用槽位后会回到场内，目标槽位由该玩家接管。
等待态中，非房主直接断线后会先保留原成员记录并标记离线；若 `30s` 内同一用户重连，则恢复原槽位或观战席；若超过 `30s` 仍未重连，占槽玩家的原槽位由 Bot 接管，离线观战成员从观战列表移除。
房主可以在等待态且未开始倒计时时移出非房主成员。被移出的占槽玩家原槽位由 Bot 接管；被移出的观战成员从观战列表移除；在线被移出者会收到移出通知并退出本地房间。

房主可以在观战状态开始倒计时。
开始倒计时只要求当前连接属于房主、房间处于 `waiting` 且已选择战斗。
倒计时默认为 `5s`，客户端可在 `room:start` 中携带 `countdownMs` 配置为 `1s` 到 `30s`。
支持跳时的战斗会在战斗静态数据中声明 `startTimeOptions`。房主可在 `room:start` 中携带 `startTimeMs`，服务端按固定 Tick 取整并校验范围；未携带时使用 `0ms`。未声明 `startTimeOptions` 的战斗只允许 `startTimeMs=0`，传入非零开始时间会返回 `invalid_start_time`。
开始倒计时时，服务端先把等待态模拟重置为标准开场状态并清空上一轮结果。
倒计时期间，服务端继续维持等待态移动同步，但不允许切换战斗、切换槽位、切换观战或新玩家加入战斗槽位。
正式开战时，服务端保留倒计时结束时的玩家位置和朝向，并把战斗时间从本轮 `startTimeMs` 开始推进。跳过时间点之前的机制由对应战斗内容脚本合成当前权威状态，服务端不实现第二套战斗规则。
当 8 个战斗槽位全部为 Bot 时，服务端允许房主直接开始倒计时。

运行中若连接断开，原玩家槽位不会立即被其他连接顶替。  
同一玩家重新加入房间后，服务端会尝试恢复其原槽位，并下发当前权威快照。

玩家主动离开真实房间时，服务端会先让该 Socket 退出 Socket.IO 房间，再广播房间状态变化。
因此离开的客户端不会收到本次离房产生的 `room:state` 回包；其他仍在房间内的成员仍会收到槽位和房间状态更新。

房间包含规则选项 `deadActorsInteract`，默认开启。  
该选项开启时，角色死亡后 `alive=false` 但 `mechanicActive=true`，仍可移动、使用通用主动能力、被机制选中、处理踩塔/连线/范围和接受击退；客户端仅按死亡状态半透明显示角色。  
房主可以在 `waiting` 且未开始倒计时时修改该选项；运行中和倒计时期间不允许修改。

## 4. 实时同步

当前实时同步基于 Socket.IO，协议定义位于：

- [packages/shared/src/index.ts](/home/etnatker/workspace/code/ff14arena_next/packages/shared/src/index.ts)

### 当前上行事件

- 房间操作事件：
  - 加入房间
  - 离开房间
  - 切换槽位
  - 切换观战
  - 开始倒计时
  - 修改房间选项
  - 快速失败
  - 重开
- 连续覆盖型输入：
  - `sim:input-frame`
- 一次性指令：
  - `sim:use-knockback-immune`
  - `sim:use-sprint`
- 主动重同步请求：
  - `sim:request-resync`

当前连续覆盖型输入统一通过 `sim:input-frame` 发送。  
该输入帧当前携带：

- `syncId`
- `issuedAt`
- `payload.position`
- `payload.facing`
- `payload.moveDirection`

### 当前下行事件

- `room:state`
  同步当前房间状态
  - `startCountdown` 表示当前开始倒计时，未倒计时时为 `null`
- `room:slots`
  同步当前槽位状态
- `room:countdown`
  服务端开始倒计时后每秒广播当前应显示的整数秒数
- `sim:start`
  倒计时结束后下发一轮新同步流的起始快照
- `sim:events`
  下发当前同步流中的增量事件
  - `actorMoved` 用于广播服务端已采信的角色位姿
  - `actorForcedMovementRequested` 用于通知真人客户端执行击退等强制位移
- `sim:snapshot`
  下发 join / rejoin / resync 快照以及周期性权威快照

当前 `sim:start`、`sim:events`、`sim:snapshot` 和客户端上行输入都会携带 `syncId`。

## 5. 权威同步行为

当前服务端同步行为如下：

- `packages/core` 消费输入并推进权威状态
- 服务端在等待态与运行态都按房间 Tick 驱动权威模拟
- 服务端按房间 Tick 广播增量事件
- 服务端按当前策略下发周期性权威快照与必要的重同步快照；周期性快照当前约每 `1s` 广播一次
- 客户端请求重同步时，服务端会向该连接回送当前权威快照、房间状态和槽位状态

当前同步模型中：

- 玩家普通移动由客户端本地模拟，并以上传位姿样本的方式同步给服务端
- 服务端先校验上行输入的 `syncId`，旧同步轮输入直接丢弃，不参与位姿序号去重
- 服务端按到达顺序接收连续位姿样本，并只保留当前 Tick 前每个 Actor 最新的待处理位姿样本
- 服务端在每个房间 Tick 开始时先收集玩家与 Bot 的统一控制帧，再推进 `packages/core`
- `waiting` 与 `running` 永远共用同一套移动链路，不维护独立实现
- `running` 只是比 `waiting` 多推进战斗脚本、AOE、伤害、Buff 与结算
- Bot controller 运行在 `core` 外部，只读取快照与 `scriptState`，再向 `core` 提交统一控制帧
- 普通移动不再做 `issuedAtServerTimeEstimate` 时间补偿，也不再回传输入确认序号
- 当前服务端不对玩家上传位姿样本执行移动速度上限校验
- `sim:input-frame` 是高频连续输入，房间不存在、槽位不匹配、同步轮过期或当前无模拟时会静默丢弃并记录丢弃指标，不逐帧回 `server:error`
- 真人玩家的击退等强制位移由服务端下发强制位移请求，目标客户端本地执行后通过 `sim:input-frame` 回传位姿结果
- Bot 的击退等强制位移仍由服务端直接执行，并通过 `actorMoved` 广播结果
- 服务端不再使用 `hard` 位置修正覆盖真人玩家本机位置
- 纯 `actorMoved` 增量事件使用 Socket.IO `volatile` 广播，客户端或网络拥塞时允许丢弃旧移动包，由后续移动事件和周期性快照修正；包含机制、伤害、状态、读条或结算的事件仍可靠广播
- 下发给客户端的 `sim:start` 与 `sim:snapshot` 会清空 `scriptState`；`scriptState` 只作为服务端战斗脚本与 Bot controller 的内部状态使用
- 客户端不会持续发送重复静止位姿帧；静止状态只在刚停止移动或朝向变化时同步

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
