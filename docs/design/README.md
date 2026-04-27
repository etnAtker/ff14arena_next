# FF14 Arena Next 设计目标与草案

本目录定义 `ff14arena_next` 的产品目标、架构边界、领域模型与 MVP 约束。

当前项目定位如下：

- Web 应用
- 多人联机机制练习
- 8 人小队固定编制
- 机制模拟优先
- 技能系统只保留与机制强相关的最小能力

当前版本不实现：

- 完整职业循环
- DPS / HPS / 减伤精确模拟
- 装备、属性、种族、食物等复杂数值系统
- 单人模式

阅读顺序：

1. [产品目标与边界](./01-product/vision.md)
2. [当前范围与非目标](./01-product/scope.md)
3. [Monorepo 结构](./02-architecture/monorepo-layout.md)
4. [系统边界](./02-architecture/system-boundaries.md)
5. [机制模拟放置位置](./02-architecture/simulation-placement.md)
6. [战斗脚本模型](./03-domain/mechanic-script.md)
7. [全局规则](./03-domain/global-rules.md)
8. [机制 Helper 设计](./03-domain/mechanic-helpers.md)
9. [遭遇状态模型](./03-domain/encounter-state.md)
10. [运行时设计](./04-runtime/tick-and-scheduler.md)
11. [输入处理链](./04-runtime/input-pipeline.md)
12. [联机设计](./05-network/multiplayer-flow.md)
13. [房间生命周期](./05-network/room-lifecycle.md)
14. [MVP 范围](./08-mvp/mvp-scope.md)
15. [欧米茄绝境战 P1：循环程序](./09-content/top-p1-program-loop.md)

文档术语：

- `core`：共享机制模拟内核
- `战斗`：房主可选择的一套完整练习内容，包含场地、Boss、脚本、Bot 脚本和显示接口定义
- `客户端镜像模拟`：浏览器内运行的只读或弱权威模拟实例
- `服务端权威模拟`：最终决定房间真实状态的模拟实例
