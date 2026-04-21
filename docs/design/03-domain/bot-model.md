# Bot 模型

## 目标

Bot 用于补齐 8 人小队，使战斗随时可开。

## 控制方式

Bot 由服务端托管。  
每个战斗附带一组 Bot 脚本。  
Bot 脚本可以读取当前局面状态，并据此决定自身动作。

## 输入模型

Bot 不直接写 Actor 状态。  
Bot 与玩家一样，向权威模拟提交标准输入。

## Bot 可执行动作

第一版 Bot 支持以下动作：

- 移动到指定点
- 面向指定方向
- 面向指定目标
- 使用防击退
- 等待

## Bot 脚本结构

Bot 脚本由战斗统一装载：

```ts
type BotPlan = {
  actorSlot: PartySlot;
  actions: BotAction[];
};
```

`BotAction` 包含：

- `move`
- `face`
- `useKnockbackImmune`
- `wait`

## Bot 脚本可读状态

Bot 脚本可以读取：

- 自身位置与朝向
- Boss 位置
- Boss 当前读条
- 其他成员位置
- 当前已激活机制对象
- 当前受伤加重状态
- 当前战斗时间

## 第一版限制

第一版 Bot 不实现：

- 复杂寻路
- 动态重规划
- 自动避圈推理
- 完整职业循环

## 扩展方向

后续扩展按以下顺序进行：

1. 固定脚本 Bot
2. 规则驱动 Bot
3. 具备局部重规划能力的 Bot
