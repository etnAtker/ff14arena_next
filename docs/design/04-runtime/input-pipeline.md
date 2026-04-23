# 输入处理链

## 输入来源

系统存在两类输入来源：

- 玩家客户端输入
- 服务端 Bot 输入

二者共用同一套移动主链，但进入 `core` 的形式不同：

- 玩家移动通过位姿样本写入当前 Actor 状态
- Bot 指令仍转换为 `SimulationInput`

## 输入结构

玩家连续移动样本包含：

- `roomId`
- `actorId`
- `inputSeq`
- `issuedAt`
- `payload.position`
- `payload.facing`
- `payload.moveDirection`

Bot 主动能力输入仍使用 `SimulationInput`，包含：

- `roomId`
- `actorId`
- `inputSeq`
- `issuedAt`
- `type`
- `payload`

## 处理流程

处理流程如下：

1. Socket 收到输入
2. 服务端校验房间、玩家、槽位和权限
3. 对玩家连续移动样本按 `actorId + inputSeq` 去重，只保留每个 Actor 的最新位姿样本
4. 房间 Tick 开始时，服务端先把待处理位姿样本写入同一个 `SimulationInstance`
5. 等待态与运行态都走同一套位姿样本写入链路，这条链路不分叉
6. Bot 指令和一次性主动能力继续进入同一个 `SimulationInput` 队列
7. `core` 在当前 Tick 中推进移动、状态与战斗逻辑
8. `core` 产出状态变化与事件

## 权限校验

服务端校验以下条件：

- 该连接属于该房间
- 该连接控制该 Actor
- 当前房间状态允许该输入
- 当前 Actor 仍然存活

## 主动能力校验

所有主动能力由 `core` 判断可用性。  
防击退统一校验：

- 是否存活
- 是否已处于防击退状态
- 是否处于冷却中

防击退的冷却与持续时间使用全局规则：

- 冷却时间 `20s`
- 持续时间 `8s`

## 拒绝原因

服务端返回以下拒绝原因：

- `not_in_room`
- `slot_not_owned`
- `actor_dead`
- `skill_on_cooldown`
