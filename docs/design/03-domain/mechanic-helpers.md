# 机制 Helper 设计

## 目标

`core` 内置一组稳定 helper。  
战斗脚本通过这些 helper 组合出具体机制。

## 分类

Helper 固定分为五类：

1. 时间类
2. 选择类
3. 空间类
4. 效果类
5. 状态类

## 时间类

时间类 helper 包含：

- `at(timeMs, fn)`
- `after(delayMs, fn)`
- `every(intervalMs, fn, window?)`
- `cancel(handle)`

## 选择类

选择类 helper 包含：

- `allPlayers()`
- `alivePlayers()`
- `bySlot(slot)`
- `randomPlayers(count, filter?)`
- `nearestTo(actor, count?)`
- `farthestFrom(actor, count?)`

## 空间类

空间类 helper 包含：

- `distance(a, b)`
- `isInsideCircle(point, circle)`
- `isInsideDonut(point, donut)`
- `isInsideSector(point, sector)`
- `isInsideRect(point, rect)`
- `facingTo(source, target)`

## 效果类

效果类 helper 包含：

- `spawnCircleAoe`
- `spawnDonutAoe`
- `spawnSectorAoe`
- `spawnRectAoe`
- `spawnShareAoe`
- `spawnSpreadAoe`
- `spawnTower`
- `spawnTether`
- `applyDamage`
- `applyStatus`
- `applyKnockback`
- `applyMarker`

## 状态类

状态类 helper 包含：

- `fail(reason)`
- `complete()`
- `setCheckpoint(id)`
- `emitHint(message)`

`fail(reason)` 支持重复调用。  
每次调用都向当前战斗的失败原因集合追加一条文本。

## 强制位移与防击退

当前全局主动技能系统只实现防击退。

相关 helper 为：

- `applyKnockback(targets, source, distance, options)`
- `grantKnockbackImmunity(targets, durationMs, source)`

结算规则如下：

- 目标存在有效防击退状态时，忽略强制位移
- 防击退不免疫伤害

## 装载方式

第一版 helper 直接内建在 `core` 中。  
战斗脚本通过上下文调用，不实现插件注册系统。
