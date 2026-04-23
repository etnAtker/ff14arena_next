# 协议概览

## 通信方式

系统使用：

- HTTP：房间列表、房间详情、静态内容
- Socket.IO：房间内实时交互

## 客户端到服务端

客户端到服务端意图事件如下：

- `room:join`
- `room:leave`
- `room:ready`
- `room:select-battle`
- `room:switch-slot`
- `room:start`
- `sim:input-frame`
- `sim:use-knockback-immune`
- `sim:request-resync`

## 服务端到客户端

服务端到客户端广播事件如下：

- `room:state`
- `room:slots`
- `sim:start`
- `sim:snapshot`
- `sim:events`
- `sim:end`
- `room:closed`

## 协议规则

- 所有房间内消息都带 `roomId`
- 所有输入都带 `inputSeq`
- 连续覆盖型输入统一通过 `sim:input-frame` 发送，载荷为绝对位姿样本
- `sim:input-frame` 在 `waiting` 与 `running` 中永远共用同一套移动链路
- 一次性指令仍保持独立事件，例如防击退
- 客户端在检测到快照缺失、相位错位或旧包覆盖风险时，可主动请求重同步
- 服务端不再做普通移动的时间补偿，也不再维护输入确认字段
- 房间内显示与等待态同步统一使用 `sim:snapshot`
- `sim:end` 只携带上一轮结果，不再单独进入结算页
