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
- `net:time-sync:request`
- `sim:input-frame`
- `sim:use-knockback-immune`
- `sim:request-resync`

## 服务端到客户端

服务端到客户端广播事件如下：

- `room:state`
- `room:slots`
- `net:time-sync:response`
- `sim:start`
- `sim:snapshot`
- `sim:events`
- `sim:end`
- `room:closed`

## 协议规则

- 所有房间内消息都带 `roomId`
- 所有输入都带 `inputSeq`
- 服务端返回最近已处理的 `inputSeq`
- 客户端会先做轻量时间同步，再为连续移动输入补上 `issuedAtServerTimeEstimate`
- 连续覆盖型输入统一通过 `sim:input-frame` 发送
- 一次性指令仍保持独立事件，例如防击退
- 客户端在检测到快照缺失、相位错位或旧包覆盖风险时，可主动请求重同步
- 第一版不实现回滚，但保留输入确认字段与重同步入口
- 房间内显示与等待态同步统一使用 `sim:snapshot`
- `sim:end` 只携带上一轮结果，不再单独进入结算页
