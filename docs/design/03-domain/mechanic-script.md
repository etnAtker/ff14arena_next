# 战斗脚本模型

## 战斗定义

战斗是一个完整的可练习内容单元，包含：

- 元数据
- 场地定义
- 槽位定义
- Boss 定义
- 战斗脚本
- Bot 脚本
- HUD 显示接口定义

结构如下：

```ts
type BattleDefinition = {
  id: string;
  name: string;
  arenaId: string;
  slots: PartySlot[];
  boss: BossDefinition;
  script: BattleScript;
  botPlans: BotPlanMap;
  hud: BattleHudDefinition;
};
```

## 脚本职责

战斗脚本负责描述：

- Boss 在什么时间读条
- Boss 在什么时间移动
- Boss 在什么时间生成判定
- Boss 在什么时间选择目标
- Boss 在什么时间结算伤害、位移、标记和死亡
- 战斗在什么条件下写入失败标记
- 战斗在什么时点结束并提交最终结果

## 脚本风格

战斗脚本使用“脚本函数 + helper API”形式。

示例：

```ts
export function buildBattle(ctx) {
  ctx.timeline.at(0, function () {
    ctx.ui.setCastBar('示例读条', 3000);
  });

  ctx.timeline.at(3000, function () {
    ctx.spawn.circleAoe({
      source: ctx.boss.id,
      radius: 5,
      damage: 5000,
    });
  });
}
```

## 脚本上下文接口

战斗脚本上下文提供以下能力：

- `timeline.at`
- `timeline.after`
- `timeline.every`
- `boss.cast`
- `boss.moveTo`
- `select.bySlot`
- `select.randomPlayers`
- `spawn.circleAoe`
- `spawn.donutAoe`
- `spawn.rectAoe`
- `spawn.shareAoe`
- `spawn.spreadAoe`
- `damage.apply`
- `status.apply`
- `displacement.knockback`
- `state.complete`
- `state.fail`
- `state.setValue`
- `state.getValue`
- `ui.setCastBar`
- `ui.setBattleMessage`
- `ui.pushHint`

## 房主选择战斗

房间启动流程固定如下：

1. 房主创建房间
2. 房主选择战斗
3. 服务端加载战斗内容
4. 服务端创建权威模拟实例
5. 玩家和 Bot 按槽位入场
6. 房主开始战斗

## 结果接口语义

`state.fail(reason)` 的语义是追加一条失败原因，并写入失败结果标记。  
该调用可以重复执行。  
引擎按调用顺序累积所有失败原因。  
该调用不会中断当前战斗，也不会停止后续脚本事件。

`state.complete(result?)` 的语义是结束战斗并提交最终结果。  
若脚本未显式传入结果，则引擎读取当前失败结果标记和失败原因集合：

- 存在失败标记时，最终结果为失败
- 不存在失败标记时，最终结果为成功
