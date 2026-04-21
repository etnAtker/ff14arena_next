# 遭遇状态模型

## 分层

遭遇状态拆成四层：

1. `staticConfig`
2. `worldState`
3. `runtimeState`
4. `scriptState`

## staticConfig

`staticConfig` 来自战斗内容，固定只读，包含：

- 场地信息
- Boss 基础信息
- 槽位定义
- 初始站位
- 战斗元数据

## worldState

`worldState` 表示当前公共世界状态，包含：

- 当前战斗时间
- 所有 Actor 公共状态
- 当前活动机制对象
- 当前房间状态

## runtimeState

`runtimeState` 由引擎维护，包含：

- 调度器队列
- 当前 Tick
- 待广播事件队列
- 当前 Cast 队列
- 内部序列号

战斗脚本不直接写入 `runtimeState`。

## scriptState

`scriptState` 存放战斗脚本临时上下文，适合存放：

- 某次随机点名结果
- 某轮组合结果
- 脚本内部计数器

## 读写方式

战斗脚本通过上下文 API 读写状态：

- `ctx.state.getBattleTime()`
- `ctx.state.setScriptValue(key, value)`
- `ctx.state.getScriptValue(key)`

战斗脚本不直接持有底层世界对象的可写引用。
