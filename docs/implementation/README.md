# 当前实现说明

本文档记录仓库当前已经落地的初版实现，用于说明 `design` 方案在代码中的实际映射关系。

当前说明面向：

- 原型联调
- 后续迭代时定位代码入口
- 区分“设计目标”和“当前已实现行为”

当前实现仍属于原型阶段。  
若本文档与后续更稳定的实现文档冲突，以更新后的稳定文档为准。

## 1. 实现范围

当前仓库已经打通以下 MVP 主链路：

- 创建房间
- 玩家加入房间
- 房主选择战斗
- 空槽自动补 Bot
- 开始战斗
- 服务端权威推进双轮练习战斗
- 同步快照与增量事件到前端
- 战斗结束后重开

当前原型使用的演示战斗为：

- `opening_two_rounds`
- 名称：`双轮组合练习`

## 2. 目录映射

### `packages/shared`

共享协议与基础类型定义位于：

- [packages/shared/src/index.ts](/home/etnatker/workspace/code/ff14arena_next/packages/shared/src/index.ts)

当前包含：

- 固定 8 槽位定义
- 房间 DTO
- Socket 事件类型
- 模拟输入类型
- 快照与增量事件结构

### `packages/core`

机制模拟内核位于：

- [packages/core/src/simulation.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/simulation.ts)
- [packages/core/src/types.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/types.ts)
- [packages/core/src/constants.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/constants.ts)
- [packages/core/src/math.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/math.ts)

当前已实现：

- 固定 `20 TPS` Tick 推进
- 简单调度器
- 玩家与 Bot 移动
- 圆形 / 环形 / 分摊 / 分散 AOE
- 伤害与死亡
- `受伤加重`
- 防击退
- 越界死亡
- 失败原因聚合
- 完成结果提交

### `packages/content`

战斗内容位于：

- [packages/content/src/index.ts](/home/etnatker/workspace/code/ff14arena_next/packages/content/src/index.ts)

当前已实现：

- `opening_two_rounds` 战斗定义
- 双轮随机组合脚本
- Bot 站位跑法
- 失败原因文本

### `apps/server`

服务端运行层位于：

- [apps/server/src/app.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/app.ts)
- [apps/server/src/room-manager.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/room-manager.ts)
- [apps/server/src/index.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/index.ts)

当前已实现：

- 房间创建
- 房间列表查询
- 加入 / 离开 / 准备
- 选择战斗
- 自动补 Bot
- 开始与重开
- 权威模拟循环
- 周期性快照广播
- 增量事件广播

### `apps/web`

Web 客户端位于：

- [apps/web/src/App.vue](/home/etnatker/workspace/code/ff14arena_next/apps/web/src/App.vue)
- [apps/web/src/stores/app.ts](/home/etnatker/workspace/code/ff14arena_next/apps/web/src/stores/app.ts)
- [apps/web/src/components/BattleStage.vue](/home/etnatker/workspace/code/ff14arena_next/apps/web/src/components/BattleStage.vue)

当前已实现：

- 首页 / 房间大厅 / 战斗页 / 结算页
- 创建并进入房间
- 房间状态与日志展示
- Pixi 场地绘制
- 角色与 AOE 基础可视化
- `WASD` 移动
- 点击场地转向
- 按 `1` 使用防击退

## 3. 当前接口

当前服务端 HTTP 接口：

- `GET /health`
- `GET /battles`
- `GET /rooms`
- `POST /rooms`

当前实时事件遵循 `packages/shared` 中定义的 Socket 协议。

## 4. 当前验证方式

当前仓库已经接入以下基础验证：

- `pnpm typecheck`
- `pnpm build`
- `pnpm lint`
- `pnpm --filter @ff14arena/server test`

服务端集成测试位于：

- [apps/server/test/app.test.mjs](/home/etnatker/workspace/code/ff14arena_next/apps/server/test/app.test.mjs)

该测试覆盖：

- 创建房间
- 立即加入
- 开始战斗
- 正常结算
- 重开后继续运行

## 5. 当前限制

当前实现仍有以下限制：

- 前端仍以原型可用为目标，交互与表现尚未细化
- 客户端没有完整镜像修正与平滑策略
- 房间规则、战斗表现和日志细节仍可继续收敛
- 尚未实现完整回放、复杂 Bot、复杂状态系统和正式持久化

## 6. 后续迭代建议

后续可按以下顺序继续收敛：

1. 修正房间与页面流转细节
2. 补全前端交互与 HUD 表现
3. 收紧 `core` 规则边界与事件语义
4. 扩展更多 battle 内容与测试覆盖
