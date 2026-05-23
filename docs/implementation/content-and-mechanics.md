# 战斗内容与机制边界

本文档描述当前 `packages/core` 与 `packages/content` 的落地边界。

相关入口：

- [packages/core/src/types.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/types.ts)
- [packages/core/src/simulation.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/simulation.ts)
- [packages/core/src/movement-runtime.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/movement-runtime.ts)
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
- `sprint`

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

`sprint` 是全局主动能力状态，展示名为“疾跑”。该状态存在时，通用移动速度计算返回默认速度的 `1.3` 倍；状态持续 `10s`，冷却 `60s`。

## 3. 通用机制 primitive

当前 core 提供以下机制快照：

- `circle`
- `donut`
- `share`
- `spread`
- `tower`
- `tether`
- `actorMarker`
- `fanTelegraph`
- `circleTelegraph`

`tower` 当前只提供展示与生命周期，不做踩塔人数、职责或失败判定。  
content 在结算时间读取 `ctx.mechanics.all()` 和当前玩家快照，自行判断塔是否成功处理。

`circleTelegraph` 只提供短时可视化预兆，不造成伤害。

`tether` 提供可配置的线段传递能力。当前可配置项包括：

- `botTransferSequence`
- `botTransferCooldownMs`
- `transferCooldownMs`
- `allowTransfer`
- `allowDeadRetarget`
- `preventTargetHoldingOtherTether`

content 可以把 `tether` 当成纯展示线，也可以启用接触式传递。传递后的伤害、状态和失败结果仍由 content 在机制结算时处理。

`actorMarker` 只提供跟随玩家的头顶标记展示与生命周期，不带默认伤害或判定。具体标记含义由 content 的战斗脚本定义。

`fanTelegraph` 只提供扇形预警展示与生命周期，不造成伤害。扇形命中、重复命中死亡和失败结果由 content 在结算时处理。

启用接触式传递时，core 会检查候选玩家当前坐标或本 tick 移动路径是否与连线线段相交。这样玩家在连续输入帧合并或网络抖动时，即使当前采样点已经越过连线，只要移动路径穿过线段，仍会完成传递。

`botTransferSequence` 与 `botTransferCooldownMs` 只限制 Bot 候选目标，不限制真人玩家穿线。

地图标点属于战斗静态数据。content 通过 `BattleDefinition.mapMarkers` 定义，core 只把它复制到快照和静态数据中，前端负责绘制。

## 4. TOP P1 循环程序

当前已落地战斗：

- id：`top_p1_program_loop`
- 名称：`欧米茄绝境战 P1：循环程序`

当前实现内容：

- 开场南侧 15m 初始站位
- 半径 15m 的 `A 2 B 3 C 4 D 1` 地图标点
- 随机分配一号、二号、三号、四号，每组 2 人
- 每局按环形索引差生成 4 轮随机双塔，塔处理顺序为一号、二号、三号、四号
- 同一编号内按 `H1 -> MT -> ST -> D1 -> D2 -> D3 -> D4 -> H2` 拆分高低优先级
- 每轮双塔从 A 点左侧开始顺时针排序，第一座塔由高优先级处理，第二座塔由低优先级处理
- 2 条持久冲击波连线，连线处理顺序为三号、四号、一号、二号
- 两条冲击波连线按高低优先级拆成两条 Bot 车道，拉线点固定为半径 `17m` 的正点
- 冲击波读条固定 `7600ms`，每次读条结束与该轮塔和冲击波结算同 tick
- 冲击波结算前 `500ms` 显示以当前连线持有者为中心的圆形预兆
- 塔会消耗任何实际进入塔内的循环程序状态，未持有循环程序状态的玩家不计入有效踩塔
- 每座塔内没有持有循环程序状态的有效踩塔者时，会触发塔爆炸并团灭
- 塔与冲击波都会由 TOP 脚本显式附加破灭
- 循环程序状态到期仍未被塔消耗时，由 TOP 脚本附加遗忘并击杀
- 冲击波额外附加体力衰减
- 破灭重复获得时由 TOP 脚本附加死宣并击杀
- 体力衰减期间再次受到 TOP 机制伤害时由 TOP 脚本击杀

## 5. Bot 与测试

TOP P1 Bot 当前是固定脚本，不实现完整智能决策。

Bot 行为来源：

- 自身状态判断当前编号
- `scriptState` 中的 Bot 车道序列判断本局接线顺序
- 本局随机塔序列、按优先级排序的接线车道与正点冲击波外侧点移动

测试入口：

- [packages/content/test/top-program-loop.test.mjs](/home/etnatker/workspace/code/ff14arena_next/packages/content/test/top-program-loop.test.mjs)

测试会固定随机序列，验证：

- 随机点名不是旧的固定分配
- 随机塔位不是旧的固定序列，每轮 2 座塔的环形索引差为 2、4 或 6，且一局内 8 个塔位不重复
- 塔和接线车道按 `H1 -> MT -> ST -> D1 -> D2 -> D3 -> D4 -> H2` 优先级分配
- 冲击波拉线点固定在半径 `17m` 的正点
- 循环程序期间持续存在 2 条冲击波连线
- 同一玩家不会同时持有两条线
- 全 Bot 能完成当前随机塔位跑法
- Bot 不会提前接走非自身轮次连线

## 6. 伊甸P4特殊

当前已落地战斗：

- id：`eden_p4_special`
- 名称：`伊甸P4特殊`

当前实现内容：

- 半径 `20m` 的圆形场地，首领目标圈半径 `5m`
- 半径 `10m` 的 `A 2 B 3 C 4 D 1` 地图标点
- 开场 `3s` 后开始 `5s` 读条“光与暗的龙诗”
- 读条结束后生成 `1T 1H 2DPS` 的“光之锁”，并按随机闭合顺序生成四条光之锁连线
- 光之锁 `7s` 后转换为“光之束缚”；光之束缚期间连线长度必须保持在 `17m` 到 `23m` 之间，束缚玩家死亡会击杀全体玩家并触发团灭
- 随机一名光之锁玩家和一名非光之锁玩家获得“黑暗狂水”，并显示头顶三箭头标记
- 正北和正南 `9m` 各生成一座半径 `3m` 的双人塔
- “光与暗的龙诗”结束后同时开始 `11s` 读条“光之波动”
- 光之波动结算前 `0.5s` 显示 4 个 `30°` 扇形预警
- 光之波动结算时，每座塔必须正好由 `2` 名光之束缚玩家处理
- 光之波动结算时，对距离场中最近的 `4` 人方向判定 `30°` 扇形；非束缚玩家首次命中会记录为本次光之波动已受击，重复命中即死并记录死亡失败原因，该记录不作为状态同步显示；束缚玩家命中即死并团灭
- 两名黑暗狂水玩家必须分别位于上下半场
- 4 名 DPS 按场中向量排序后必须间隔出现或连续出现

Bot 当前是确定性脚本，不实现完整智能决策。

Bot 行为来源：

- 玩家与 Bot 初始出生点即读条队列点，`MT ST H1 H2` 在北侧、`D1 D2 D3 D4` 在南侧
- 光与暗的龙诗读条结束后，Bot 延迟 `2000ms` 才开始移动
- 延迟结束后，Bot 先移动到只处理换位 1 的假设位置；再经过 `3000ms` 后，Bot 执行换位 2 或未换位 1 的对角扇形交换并移动到最终点
- `scriptState` 中的光之锁闭合连线顺序判断是否需要换位 1
- `scriptState` 中的黑暗狂水点名判断是否需要换位 2 或未换位 1 的对角扇形交换
- 固定塔内点和固定 B/D 扇形引导点移动

当前 Bot 固定点位：

- 北塔左/右：`(-0.6, -9)`、`(0.6, -9)`
- 南塔左/右：`(-0.6, 9)`、`(0.6, 9)`
- D 北/南：`(-4, -1.2)`、`(-4, 1.2)`
- B 北/南：`(4, -1.2)`、`(4, 1.2)`

未换位 1 时，假设位置为点名 T/H 进北塔，点名 DPS 进南塔，未点名 T/H 在北半场引导，未点名 DPS 在南半场引导。若两名黑暗狂水同半场，则最终位置为有黑暗狂水的扇形玩家与中心对角的扇形玩家交换：`D北 <-> B南`、`B北 <-> D南`。

已换位 1 时，假设位置为 H 与自身连线的 DPS 交换队列位置；北塔为 T 左、该 DPS 右，南塔为另一名 DPS 左、H 右，D 方向两名引导者先交换。若两名黑暗狂水同半场，则最终位置为每个塔内组和每个 B/D 引导组内两两交换。

测试入口：

- [packages/content/test/eden-p4-special.test.mjs](/home/etnatker/workspace/code/ff14arena_next/packages/content/test/eden-p4-special.test.mjs)

测试会固定随机序列，验证：

- 全 Bot 能完成多组随机跑法
- 未换位 1 且黑暗狂水同半场时，对角扇形交换可以同时满足黑暗狂水上下半场与 DPS 排列判定
