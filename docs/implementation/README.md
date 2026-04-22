# 当前实现说明

本文档用于说明仓库当前已经落地的实现范围、代码入口和验证方式。  
它是 `docs/implementation` 的总览页，不承载过细的模块细节。

当前实现仍属于原型阶段。  
若本文档与后续更稳定的实现文档冲突，以更新后的稳定文档为准。

## 1. 用途

本文档主要用于：

- 原型联调时快速确认当前已实现范围
- 后续迭代时定位代码入口
- 区分设计目标与当前实际行为

## 2. 当前范围

当前仓库已经打通以下 MVP 主链路：

- 创建房间
- 玩家加入房间
- 房主选择战斗
- 空槽自动补 Bot
- 开始战斗
- 服务端权威推进战斗
- 同步快照与增量事件到前端
- 战斗结束后重开

当前演示战斗为：

- `opening_two_rounds`
- 名称：`双轮组合练习`

## 3. 实现索引

### 子文档

- [Web 客户端当前实现说明](./web-client.md)
- [部署说明](./deployment.md)

### 模块入口

- `packages/shared`
  共享协议、房间 DTO、输入类型、快照与事件定义
  入口：
  [packages/shared/src/index.ts](/home/etnatker/workspace/code/ff14arena_next/packages/shared/src/index.ts)

- `packages/core`
  战斗模拟内核，负责 Tick 推进、输入消费、移动、AOE、伤害、状态和结果结算
  入口：
  [simulation.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/simulation.ts),
  [types.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/types.ts),
  [constants.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/constants.ts),
  [math.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/math.ts)

- `packages/content`
  战斗内容定义，当前包含演示战斗脚本、Bot 跑法与失败原因文本
  入口：
  [packages/content/src/index.ts](/home/etnatker/workspace/code/ff14arena_next/packages/content/src/index.ts)

- `apps/server`
  房间与权威模拟托管，负责房间生命周期、加入离开、准备、开始、重开和同步广播
  入口：
  [app.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/app.ts),
  [room-manager.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/room-manager.ts),
  [index.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/index.ts)

- `apps/web`
  Web 客户端，负责页面结构、房间展示、战斗画布、HUD 和玩家输入
  入口：
  [App.vue](/home/etnatker/workspace/code/ff14arena_next/apps/web/src/App.vue),
  [app.ts](/home/etnatker/workspace/code/ff14arena_next/apps/web/src/stores/app.ts),
  [BattleStage.vue](/home/etnatker/workspace/code/ff14arena_next/apps/web/src/components/BattleStage.vue)

## 4. 当前接口与验证

当前服务端 HTTP 接口：

- `GET /health`
- `GET /battles`
- `GET /rooms`
- `POST /rooms`

实时通信遵循 `packages/shared` 中定义的 Socket 协议。

当前基础验证方式：

- `pnpm typecheck`
- `pnpm build`
- `pnpm lint`
- `pnpm --filter @ff14arena/server test`

服务端集成测试位于：

- [apps/server/test/app.test.mjs](/home/etnatker/workspace/code/ff14arena_next/apps/server/test/app.test.mjs)

当前覆盖的关键链路：

- 创建房间
- 立即加入
- 开始战斗
- 正常结算
- 重开后继续运行

## 5. 当前限制

当前实现仍有以下限制：

- 前端仍以原型可用为目标，交互与表现仍可继续细化
- 客户端没有完整镜像修正与平滑策略
- 房间大厅仍未实现聊天、踢人、手动补 Bot / 移除 Bot、调整槽位
- 房间规则、战斗表现和日志细节仍可继续收敛
- 尚未实现完整回放、复杂 Bot、复杂状态系统和正式持久化

## 6. 后续收敛方向

建议按以下顺序继续收敛：

1. 补齐房间大厅缺失的多人协作操作与消息能力
2. 完善前端镜像修正、平滑和更多战斗表现
3. 收紧 `core` 规则边界与事件语义
4. 扩展更多 battle 内容与测试覆盖
