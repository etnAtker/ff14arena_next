# 实现概览

本文档用于说明仓库当前已经落地的实现范围、主要模块入口、验证方式与当前边界。

## 1. 当前范围

当前仓库已经打通以下主链路：

- 创建房间
- 玩家加入房间
- 房主选择战斗
- 空槽自动补 Bot
- 房主开始战斗
- 服务端权威推进战斗
- 服务端向客户端广播快照与增量事件
- 战斗结束后回到待开始状态
- 运行中断线后按原槽位重连
- 客户端主动请求重同步

当前已登记战斗为：

- `top_p1_program_loop`
- 名称：`欧米茄绝境战 P1：循环程序`

## 2. 模块入口

- `packages/shared`
  共享协议、房间 DTO、输入类型、快照与事件定义
  入口：
  [packages/shared/src/index.ts](/home/etnatker/workspace/code/ff14arena_next/packages/shared/src/index.ts)

- `packages/core`
  战斗模拟内核，负责 Tick 推进、输入消费、移动、通用机制 primitive、伤害、状态和结果聚合
  入口：
  [simulation.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/simulation.ts),
  [types.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/types.ts),
  [constants.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/constants.ts),
  [math.ts](/home/etnatker/workspace/code/ff14arena_next/packages/core/src/math.ts)

- `packages/content`
  战斗内容定义，当前包含战斗脚本、机制私有结算、Bot 跑法与失败原因文本
  入口：
  [packages/content/src/index.ts](/home/etnatker/workspace/code/ff14arena_next/packages/content/src/index.ts)

- `apps/server`
  房间与权威模拟托管，负责房间生命周期、加入离开、准备、开始、重开、断线重连和同步广播
  入口：
  [app.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/app.ts),
  [room-manager.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/room-manager.ts),
  [index.ts](/home/etnatker/workspace/code/ff14arena_next/apps/server/src/index.ts)

- `apps/web`
  Web 客户端，负责页面结构、房间展示、战斗画布、HUD、输入发送与同步状态处理
  入口：
  [App.vue](/home/etnatker/workspace/code/ff14arena_next/apps/web/src/App.vue),
  [app.ts](/home/etnatker/workspace/code/ff14arena_next/apps/web/src/stores/app.ts),
  [BattleStage.vue](/home/etnatker/workspace/code/ff14arena_next/apps/web/src/components/battle/BattleStage.vue)

## 3. 验证方式

当前基础验证方式：

- `pnpm typecheck`
- `pnpm build`
- `pnpm lint`
- `pnpm --filter @ff14arena/server test`

服务端集成测试位于：

- [apps/server/test/app.test.mjs](/home/etnatker/workspace/code/ff14arena_next/apps/server/test/app.test.mjs)
- [packages/content/test/top-program-loop.test.mjs](/home/etnatker/workspace/code/ff14arena_next/packages/content/test/top-program-loop.test.mjs)

当前测试覆盖的关键链路：

- 创建房间并立即加入
- 等待态快照下发
- 开始战斗
- 正常结算并回到待开始
- 房主离开后销毁房间
- 运行中断线后按原槽位重连
- 客户端主动请求重同步
- TOP P1 循环程序随机点名、持久连线、Bot 固定跑法与成功结算

## 4. 当前边界

当前实现仍属于原型阶段。  
当前仓库不包含以下能力：

- 正式持久化
- 完整回放
- 复杂 Bot 系统
- 复杂状态系统
- 完整副本随机策略与通用内容编辑器

具体待办、待优化项与后续可选方向请查看：

- [docs/todo/README.md](/home/etnatker/workspace/code/ff14arena_next/docs/todo/README.md)
