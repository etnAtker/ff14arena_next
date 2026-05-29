# Scripts

## 状态图标同步

脚本：

- [sync-status-assets.mjs](/home/etnatker/workspace/code/ff14arena_next/scripts/sync-status-assets.mjs)

用途：

- 从 XIVAPI Status 接口同步项目状态的名称、描述、图标路径和小队列表排序权重
- 从 XIVAPI asset 接口下载状态图标
- 生成 `packages/content/src/generated/status-metadata.ts`

用法：

```bash
pnpm sync:status-assets
pnpm sync:status-assets -- -f
```

说明：

- 状态资料接口：`https://xivapi-v2.xivcdn.com/api/sheet/Status/{id}?language=chs`
- 图标资源接口：`https://v2.xivapi.com/api/asset?path={Icon.path}&format=png`
- 默认跳过已经存在的图标
- `-f` 会强制重新下载所有图标

## 8 人网页复现

脚本：

- [repro-8p-web.mjs](/home/etnatker/workspace/code/ff14arena_next/scripts/repro-8p-web.mjs)

用途：

- 使用 Playwright 打开 8 个独立浏览器上下文
- 为每个上下文写入独立本地用户身份
- 通过页面创建 / 加入房间、准备、开始
- 通过网页键盘事件模拟 8 人同时移动
- 统计每个客户端是否发出 `sim:input-frame`
- 统计观察客户端收到的 `actorMoved` 覆盖人数
- 统计最新快照中实际发生位移的槽位数

用法：

```bash
node scripts/repro-8p-web.mjs --base-url https://arena.etnatker.top
```

可选参数：

- `--headed`：使用有头浏览器
- `--hold-ms <ms>`：移动持续时间，默认 `3000`
- `--timeout-ms <ms>`：页面操作超时，默认 `20000`
- `--artifacts-dir <dir>`：失败截图目录
- `--keep-open`：结束后保持浏览器打开，便于人工检查

## 网络延迟模拟

仓库提供两套 `tc netem` 脚本，用于在 Linux / WSL 环境下从网卡层模拟延迟。

### 1. 同机回环

适用场景：

- 浏览器和服务端都在同一台 Linux 机器
- 或都在同一套 WSL 环境中，通过 `lo` 通信

脚本：

- [netem-lo-on.sh](/home/etnatker/workspace/code/ff14arena_next/scripts/netem-lo-on.sh)
- [netem-lo-off.sh](/home/etnatker/workspace/code/ff14arena_next/scripts/netem-lo-off.sh)

用法：

```bash
bash ./scripts/netem-lo-on.sh lo 100 20 0
bash ./scripts/netem-lo-off.sh lo
```

参数含义：

- 第 1 个参数：网卡，默认 `lo`
- 第 2 个参数：单向固定延迟毫秒，默认 `100`
- 第 3 个参数：抖动毫秒，默认 `20`
- 第 4 个参数：丢包百分比，默认 `0`

对于本机回环，`100ms` 单向延迟通常对应约 `200ms RTT`。

### 2. 真实网卡双向

适用场景：

- 浏览器和服务端不在同一台机器
- 浏览器在 Windows，服务端在 WSL2
- 需要同时控制真实网卡的入站和出站延迟

脚本：

- [netem-ifb-on.sh](/home/etnatker/workspace/code/ff14arena_next/scripts/netem-ifb-on.sh)
- [netem-ifb-off.sh](/home/etnatker/workspace/code/ff14arena_next/scripts/netem-ifb-off.sh)

用法：

```bash
bash ./scripts/netem-ifb-on.sh eth0 ifb0 100 20 0
bash ./scripts/netem-ifb-off.sh eth0 ifb0
```

参数含义：

- 第 1 个参数：真实网卡，默认 `eth0`
- 第 2 个参数：IFB 设备名，默认 `ifb0`
- 第 3 个参数：单向固定延迟毫秒，默认 `100`
- 第 4 个参数：抖动毫秒，默认 `20`
- 第 5 个参数：丢包百分比，默认 `0`

### 3. 查看网卡名

不确定网卡时可先执行：

```bash
ip addr
ip route
```

### 4. 注意事项

- 脚本依赖 `tc`、`ip`、`modprobe`
- 需要 `sudo`
- `lo` 方案更适合同机调试
- `ifb` 方案更适合真实网卡双向模拟
- 使用完成后务必执行对应的 `off` 脚本恢复环境
