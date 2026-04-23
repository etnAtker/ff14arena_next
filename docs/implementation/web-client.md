# Web 客户端当前实现说明

本文档描述 `apps/web` 当前已经落地的实现。  
本文档只说明当前行为与代码结构，不记录修改过程。

相关代码入口：

- [apps/web/src/App.vue](/home/etnatker/workspace/code/ff14arena_next/apps/web/src/App.vue)
- [apps/web/src/stores/app.ts](/home/etnatker/workspace/code/ff14arena_next/apps/web/src/stores/app.ts)
- [apps/web/src/components/battle/BattleStage.vue](/home/etnatker/workspace/code/ff14arena_next/apps/web/src/components/battle/BattleStage.vue)

## 1. 页面结构

当前客户端包含以下页面：

- 首页
- 模拟页

当前切换规则如下：

- 未进入房间时显示首页
- 进入任意房间后直接显示模拟页

## 2. 页面分工

当前前端页面壳层分工如下：

- `App.vue`
  负责 provider、顶层状态、键盘输入、镜头状态与页面切换
- `components/layout`
  负责顶栏等全局壳层组件
- `components/pages`
  负责首页和模拟页页面组件
- `components/battle`
  负责战斗场地、镜头换算与场景绘制
- `utils/ui.ts`
  负责 phase 标签、槽位颜色、角色简写等展示辅助逻辑

当前页面与资源加载策略如下：

- 页面组件与战斗视图按需异步加载
- 首屏完成后，客户端会后台预加载其余页面模块、战斗渲染模块和 Socket 客户端依赖
- Socket 连接仍在首次需要联机时才创建

## 3. 操控模式

当前客户端支持两种本地操控模式：

- 传统
- 标准

该设置保存在浏览器本地存储中。

### 传统模式

- 左键拖拽改变镜头朝向
- 右键拖拽改变镜头朝向
- 左键和右键拖拽都不会直接改变人物面向
- `WASD` 移动方向以当前镜头朝向为准
- 人物在移动时自动朝向当前移动方向

### 标准模式

- 左键拖拽只改变镜头朝向
- 右键拖拽同时改变镜头朝向和人物朝向
- 右键拖拽时，人物面向与当前镜头方向保持一致
- `WASD` 移动方向以人物当前面向为准
- 移动本身不会修改人物面向

### 通用输入

- 键盘 `1` 触发防击退
- 连续覆盖型输入按固定间隔发送
- 房间操作与防击退这类一次性命令仍保持独立事件

## 4. 输入与同步

当前客户端同步状态集中在 `stores/app.ts`。

### 当前输入链

- 连续覆盖型输入统一通过 `sim:input-frame` 发送
- 输入帧包含：
  - `moveDirection`
  - 可选 `facing`
  - `inputSeq`
  - `issuedAt`
- 客户端本地维护递增的 `inputSeq`
- 服务端在 `sim:events` 与 `sim:snapshot` 中回传 `acknowledgedInputSeq`
- 客户端根据 `acknowledgedInputSeq` 清理待确认输入记录

### 当前快照链

- `sim:start` 下发一轮新同步流的起始快照
- `sim:events` 下发运行中的增量事件
- `sim:snapshot` 下发等待态快照、周期性运行态快照和重同步快照
- 每一轮快照与事件都带 `syncId`
- 客户端只接受当前 `syncId` 的同步流，旧 `syncId` 数据会被丢弃

### 当前重同步行为

- 客户端在缺失权威快照或怀疑相位错位时，会主动发送 `sim:request-resync`
- 服务端会向该连接回送当前权威快照、房间状态和槽位状态
- 运行中断线后，客户端重新加入房间会收到当前权威快照

### 当前本地预览边界

- 当前只实现了本地朝向预览
- 本地朝向预览不会直接改写权威快照，而是通过前端派生态叠加显示
- 本机位置移动当前仍以服务端回包为准
- 当前尚未实现完整的本地位置预测或高延迟移动优化

## 5. 镜头与绘制

当前战斗场地绘制使用 PixiJS。

当前镜头行为如下：

- 镜头朝向由鼠标拖拽控制
- 进入房间或重新开始时，初始镜头朝向与当前受控角色面向一致
- 鼠标滚轮控制缩放
- 双击场地重置缩放到默认值
- 当前受控玩家始终绘制在画面中心点偏下固定位置
- 当没有可控角色时，画面回到场地中心绘制

当前场地会绘制：

- 场地边界
- Boss 目标环
- Boss 本体
- 玩家与 Bot 位置点及职能简写
- 朝向指示线
- 圆形 / 环形 / 分摊 / 分散 AOE
- 顶部 Boss 读条覆盖层

## 6. HUD 与信息展示

当前模拟页左栏显示：

- 8 个固定槽位卡片
- 槽位名、成员名与切换 / 准备 / 开始按钮
- 当前 HP / 最大 HP
- 按职能区分的底色与自己的强调色

当前模拟页右栏显示：

- 上一轮结果摘要
- 失败原因列表
- 当前 8 人状态摘要
- 实时战斗日志

当前等待态与战斗中都使用 `SimulationSnapshot` 作为主要展示数据：

- `waiting` 阶段用于进房预览、切槽和等待开始
- `running` 阶段用于权威模拟展示
- `latestResult` 用于右侧栏展示上一轮结果

## 7. 当前边界

当前前端仍以原型可用为目标。  
当前前端不包含完整的高延迟移动优化、本地位置预测和完整聊天能力。

具体待办与后续优化方向请查看：

- [docs/todo/README.md](/home/etnatker/workspace/code/ff14arena_next/docs/todo/README.md)
