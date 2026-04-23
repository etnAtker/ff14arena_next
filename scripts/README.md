# Scripts

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
