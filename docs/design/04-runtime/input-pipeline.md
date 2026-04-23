# 输入处理链

## 输入来源

系统存在两类输入来源：

- 玩家客户端输入
- 服务端 Bot 输入

二者统一转换为 `SimulationInput`。

## 输入结构

输入结构包含：

- `roomId`
- `actorId`
- `inputSeq`
- `issuedAt`
- 可选 `issuedAtServerTimeEstimate`
- `type`
- `payload`

## 处理流程

处理流程如下：

1. Socket 收到输入
2. 服务端校验房间、玩家、槽位和权限
3. 对连续移动输入，把 `issuedAtServerTimeEstimate` 从墙钟时间换算到当前权威模拟时间轴
4. 服务端统一将输入交给同一个 `SimulationInstance`
5. 等待态与运行态都把输入压入同一条权威输入队列，并在房间 Tick 中批量消费
6. 输入转换为具体动作意图
7. `core` 结合最近移动历史做受控补偿并推进权威状态
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
- `room_not_running`
- `skill_on_cooldown`
