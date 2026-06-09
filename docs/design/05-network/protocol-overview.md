# 协议概览

## 通信方式

系统使用：

- HTTP：房间列表、房间详情、静态内容
- Socket.IO：房间内实时交互

实时模拟链路支持按连接协商承载方式：

- 默认 JSON：用于旧客户端、测试与兼容场景
- Protobuf 二进制：客户端加入房间时通过 `room:join.realtimeEncoding = "protobuf"` 声明

当前使用 Protobuf 承载的事件为：

- `sim:start`
- `sim:snapshot`
- `sim:events`
- `sim:input-frame`

房间状态、槽位、倒计时、结算与错误事件仍使用 JSON。

## 客户端到服务端

客户端到服务端意图事件如下：

- `room:join`
- `room:leave`
- `room:select-battle`
- `room:switch-slot`
- `room:spectate`
- `room:start`
- `sim:input-frame`
- `sim:use-knockback-immune`
- `sim:use-sprint`
- `sim:request-resync`

## 服务端到客户端

服务端到客户端广播事件如下：

- `room:state`
- `room:slots`
- `room:countdown`
- `sim:start`
- `sim:snapshot`
- `sim:events`
- `sim:end`
- `room:closed`

## 协议规则

- 所有房间内消息都带 `roomId`
- `POST /rooms` 只创建建房申请并返回 `roomId` 与 `expiresAt`，真实房间由房主 `room:join` 成功后实例化
- `room:start` 可携带 `countdownMs`，服务端校验后进入开始倒计时
- `room:state` 携带当前 `startCountdown`，客户端据此显示全员倒计时
- `room:countdown` 由服务端每秒广播当前应显示的整数秒数，客户端不自行推算倒计时数字
- 所有模拟输入都带当前 `syncId`
- 连续覆盖型输入统一通过 `sim:input-frame` 发送，载荷为绝对位姿样本
- `sim:input-frame` 在 `waiting` 与 `running` 中永远共用同一套移动链路
- 一次性指令仍保持独立事件，例如防击退
- 客户端在检测到快照缺失、相位错位或旧包覆盖风险时，可主动请求重同步
- 服务端不再做普通移动的时间补偿，也不再维护输入确认字段
- 房间内显示与等待态同步统一使用 `sim:snapshot`
- `sim:end` 只携带上一轮结果，不再单独进入结算页
