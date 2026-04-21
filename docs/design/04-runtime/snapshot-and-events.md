# 快照与增量事件

## 快照

快照用于：

- 初次加入房间
- 断线重连
- 状态校正

快照包含：

- 房间状态
- 当前战斗
- 当前战斗时间
- 当前结果标记
- 当前失败原因集合
- 所有 Actor 核心状态
- 当前活动机制对象
- Boss 当前读条和动作状态

## 增量事件

增量事件用于：

- 实时联机广播
- 前端表现驱动
- 后续回放复用

事件类型包括：

- `actorMoved`
- `bossCastStarted`
- `bossCastResolved`
- `aoeSpawned`
- `aoeResolved`
- `damageApplied`
- `statusApplied`
- `actorDied`
- `battleMessageChanged`
- `battleFailureMarked`
- `encounterCompleted`

## 同步策略

同步策略固定如下：

- 每 Tick 合并广播增量事件
- 每 `500ms` 发送一次轻量快照

## 事件字段

每条增量事件包含：

- `eventId`
- `tick`
- `timeMs`
- `type`
- `payload`

## 结果事件语义

`battleFailureMarked` 表示当前战斗已经写入失败结果标记。  
该事件只用于 HUD、日志和复盘提示，不结束战斗。  
该事件的 `payload` 包含本次新增的失败原因，以及追加后的失败原因集合。

`encounterCompleted` 表示战斗流程已经结束，并携带最终结果：

- `success`
- `failure`

`encounterCompleted.payload` 同时携带最终失败原因集合。
