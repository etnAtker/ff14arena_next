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
- `sim:move`
- `sim:face`
- `sim:use-knockback-immune`

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
- 服务端返回最近已处理的 `inputSeq`
- 第一版不实现回滚，但保留输入确认字段
- 房间内显示与等待态同步统一使用 `sim:snapshot`
- `sim:end` 只携带上一轮结果，不再单独进入结算页
