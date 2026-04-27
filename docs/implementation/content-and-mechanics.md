# 战斗内容与机制边界

本文档描述当前 `packages/core` 与 `packages/content` 的落地边界。

相关入口：

- [packages/core/src/types.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/types.ts)
- [packages/core/src/simulation.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/simulation.ts)
- [packages/content/src/index.ts](/home/etnatker/workspace/code/ff14arena_next/packages/content/src/index.ts)
- [packages/content/src/battles/top-p1-program-loop.ts](/home/etnatker/workspace/code/ff14arena_next/packages/content/src/battles/top-p1-program-loop.ts)

## 1. 模块职责

`packages/core` 负责通用运行能力：

- 固定 tick 推进
- 角色移动、越界、死亡与结果聚合
- 通用 AOE primitive 的生命周期与默认结算
- 状态挂载、移除、过期刷新与同步
- 可视化机制快照的创建与同步
- content 可调用的伤害、击杀、状态和脚本状态 API

`packages/content` 负责战斗私有规则：

- 点名、分组、时间轴与 Boss 读条
- 场地静态标点
- 塔、连线、冲击波等机制的具体成功与失败条件
- 私有状态的显示名、持续时间和副作用
- Bot 跑法
- 战斗文案和失败原因

core 不写入具体副本的机制结论。  
例如循环程序中的“破灭刻印重复获得时死亡”“体力衰减期间再次受伤死亡”属于 TOP 内容规则，由 TOP 脚本显式调用 `ctx.damage.kill` 处理。

## 2. 状态模型

`StatusId` 当前为字符串。  
core 只对少量内置状态保留通用行为：

- `injury_up`
- `knockback_immune`

content 可以创建任意状态 ID。  
状态展示名由 `ctx.status.apply(..., { name })` 传入；若未传入展示名，core 使用状态 ID 作为显示名。

当前 TOP P1 使用的状态包括：

- `program_loop_1`：一号
- `program_loop_2`：二号
- `program_loop_3`：三号
- `program_loop_4`：四号
- `twice_come_ruin`：破灭
- `hp_penalty`：衰减
- `doom`：死宣
- `memory_loss`：遗忘

这些状态的副作用不在 core 中实现。

## 3. 通用机制 primitive

当前 core 提供以下机制快照：

- `circle`
- `donut`
- `share`
- `spread`
- `tower`
- `tether`

`tower` 当前只提供展示与生命周期，不做踩塔人数、职责或失败判定。  
content 在结算时间读取 `ctx.mechanics.all()` 和当前玩家快照，自行判断塔是否成功处理。

`tether` 提供可配置的线段传递能力。当前可配置项包括：

- `allowedTargets`
- `transferRadius`
- `transferCooldownMs`
- `minSourceDistance`
- `allowTransfer`
- `allowDeadRetarget`
- `preventTargetHoldingOtherTether`

content 可以把 `tether` 当成纯展示线，也可以启用接触式传递。传递后的伤害、状态和失败结果仍由 content 在机制结算时处理。

启用接触式传递时，core 会同时检查候选玩家当前坐标与本 tick 移动路径到连线线段的距离。这样玩家在连续输入帧合并或网络抖动时，即使当前采样点已经越过连线，只要移动路径穿过 `transferRadius`，仍会完成传递。

地图标点属于战斗静态数据。content 通过 `BattleDefinition.mapMarkers` 定义，core 只把它复制到快照和静态数据中，前端负责绘制。

## 4. TOP P1 循环程序

当前已落地战斗：

- id：`top_p1_program_loop`
- 名称：`欧米茄绝境战 P1：循环程序`

当前实现内容：

- 开场南侧 15m 初始站位
- 半径 15m 的 `A 2 B 3 C 4 D 1` 地图标点
- 随机分配一号、二号、三号、四号，每组 2 人
- 4 轮塔判定，塔处理顺序为一号、二号、三号、四号
- 2 条持久冲击波连线，连线处理顺序为三号、四号、一号、二号
- 连线按本局随机结果拆成两条车道，供第一版 Bot 固定跑法使用
- 塔会消耗任何实际进入塔内的循环程序状态，未持有循环程序状态的玩家不计入有效踩塔
- 塔与冲击波都会由 TOP 脚本显式附加破灭
- 循环程序状态到期仍未被塔消耗时，由 TOP 脚本附加遗忘并击杀
- 冲击波额外附加体力衰减
- 破灭重复获得时由 TOP 脚本附加死宣并击杀
- 体力衰减期间再次受到 TOP 机制伤害时由 TOP 脚本击杀

## 5. Bot 与测试

TOP P1 Bot 当前是固定脚本，不实现完整智能决策。

Bot 行为来源：

- 自身状态判断当前编号
- 当前连线的允许目标序列判断本局车道
- 固定塔位、接线点与冲击波外侧点移动

测试入口：

- [packages/content/test/top-program-loop.test.mjs](/home/etnatker/workspace/code/ff14arena_next/packages/content/test/top-program-loop.test.mjs)

测试会固定随机序列，验证：

- 随机点名不是旧的固定分配
- 循环程序期间持续存在 2 条冲击波连线
- 同一玩家不会同时持有两条线
- 全 Bot 能完成当前固定跑法
