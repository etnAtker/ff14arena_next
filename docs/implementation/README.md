# 当前实现文档索引

`docs/implementation` 用于描述仓库中已经落地的实现。  
本目录只说明“现在代码实际如何工作”，不记录修改过程、讨论过程或后续规划。

## 文档索引

- [实现概览](./overview.md)
- [战斗内容与机制边界](./content-and-mechanics.md)
- [服务端运行与同步](./server-runtime.md)
- [Web 客户端当前实现说明](./web-client.md)
- [部署说明](./deployment.md)

## 使用约定

- 需要了解当前主链路、模块入口与验证方式时，先看 [实现概览](./overview.md)
- 需要了解 `core` 与 `content` 的机制边界、TOP P1 当前实现时，查看 [战斗内容与机制边界](./content-and-mechanics.md)
- 需要了解房间生命周期、HTTP 接口、实时同步与服务端性能观测时，查看 [服务端运行与同步](./server-runtime.md)
- 需要了解页面结构、输入发送、镜头、HUD 与性能观测页时，查看 [Web 客户端当前实现说明](./web-client.md)
- 需要了解开发与生产部署方式时，查看 [部署说明](./deployment.md)

待办事项、待优化项与后续可选方向统一放在：

- [docs/todo/README.md](/home/etnatker/workspace/code/ff14arena_next/docs/todo/README.md)
