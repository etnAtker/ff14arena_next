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
- `room:start`
- `room:restart`
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
- `sim:restart`

## 协议规则

- 所有房间内消息都带 `roomId`
- 所有输入都带 `inputSeq`
- 服务端返回最近已处理的 `inputSeq`
- 第一版不实现回滚，但保留输入确认字段
