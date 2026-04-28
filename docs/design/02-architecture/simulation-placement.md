# 机制模拟放置位置

## 结论

机制模拟放在 `packages/core`。

不允许放在：

- Vue 组件
- Pinia store
- Pixi scene 对象
- Fastify route handler
- Socket.IO 事件回调

## 一套内核，多端运行

浏览器和服务端都运行同一套 `core`。  
业务规则只实现一份。

## 联机模型

联机模式采用：

- 服务端权威模拟
- 客户端镜像模拟

服务端负责最终位置、受击结果、血量变化、死亡状态和失败判定。  
客户端负责输入、显示和平滑表现。

## 第一版实现

第一版采用：

- 服务端 `20 TPS` 权威推进
- 客户端以服务端事件为主进行展示
- 客户端镜像只承担平滑和 HUD 维持

## core 最小接口

```ts
createSimulation(config);
simulation.loadBattle(options);
simulation.start();
simulation.stop();
simulation.tick(deltaMs);
simulation.submitActorControlFrame(frame);
simulation.getSnapshot();
simulation.drainEvents();
```
