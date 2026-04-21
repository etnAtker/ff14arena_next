# 小队与 Actor 模型

## 小队规模

系统固定采用 8 人小队。

标准槽位如下：

- `MT`
- `ST`
- `H1`
- `H2`
- `D1`
- `D2`
- `D3`
- `D4`

## 槽位意义

槽位用于：

- 房间编组
- 战斗脚本选人
- Bot 跑位脚本
- UI 展示

当前实现中，槽位不决定血量、防御或仇恨差异。

## Actor 分类

系统包含三类 Actor：

- `player`
- `bot`
- `boss`

## Actor 通用字段

所有 Actor 统一包含以下字段：

- `id`
- `kind`
- `slot`
- `name`
- `position`
- `facing`
- `moveState`
- `maxHp`
- `currentHp`
- `alive`
- `statuses`
- `knockbackImmune`

## 玩家与 Bot

玩家与 Bot 使用同一套战斗字段。

固定规则如下：

- 最大血量 `10000`
- 默认移动速度 `6m/s`
- 初始朝向由战斗定义给定
- 存活时可移动
- 死亡后停止移动并保留尸体位置

玩家额外记录：

- 连接状态
- 最近输入序列号
- 当前准备状态

Bot 额外记录：

- 当前脚本执行位置
- 最近一次决策时间

## Boss

Boss 额外记录以下字段：

- 当前读条
- 当前动作队列
- 当前目标引用
- 当前脚本上下文
- 当前战斗脚本执行位置

## 位置与朝向

位置系统使用二维平面：

- `x`
- `y`
- `facing`

移动系统规则如下：

- 玩家与 Bot 按 `6m/s` 推进
- Boss 位移速度由战斗脚本显式指定
- 位置按 Tick 递进计算
- 场地边界判定在位移结算后执行

## 状态分层

Actor 状态按三层存放：

- `baseState`
- `runtimeState`
- `scriptState`

`baseState` 存放稳定字段。  
`runtimeState` 存放当前战斗过程字段。  
`scriptState` 存放战斗脚本私有数据。
