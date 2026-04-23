#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const watcherSpecs = [
  {
    name: '@ff14arena/shared',
    label: 'shared',
    cwd: 'packages/shared',
    packageName: 'tsup',
    binName: 'tsup',
    args: ['--watch'],
  },
  {
    name: '@ff14arena/core',
    label: 'core',
    cwd: 'packages/core',
    packageName: 'tsup',
    binName: 'tsup',
    args: ['--watch'],
  },
  {
    name: '@ff14arena/content',
    label: 'content',
    cwd: 'packages/content',
    packageName: 'tsup',
    binName: 'tsup',
    args: ['--watch'],
  },
  {
    name: '@ff14arena/server',
    label: 'server',
    cwd: 'apps/server',
    packageName: 'tsx',
    binName: 'tsx',
    args: ['watch', 'src/index.ts'],
    extendEnv(baseEnv) {
      if (process.platform === 'win32') {
        return baseEnv;
      }
      return { ...baseEnv, TMPDIR: '/tmp' };
    },
  },
  {
    name: '@ff14arena/web',
    label: 'web',
    cwd: 'apps/web',
    packageName: 'vite',
    binName: 'vite',
    args: [],
  },
];

const watchers = new Map();
let shuttingDown = false;
let interruptedByUser = false;
let failureCode = 0;
const maxLabelLength = Math.max(...watcherSpecs.map((spec) => spec.label.length));
const prefixColors = ['\x1b[36m', '\x1b[33m', '\x1b[35m', '\x1b[32m', '\x1b[34m'];

function formatPrefix(spec, index) {
  const plain = `[${spec.label.padEnd(maxLabelLength, ' ')}]`;
  if (!process.stdout.isTTY && !process.stderr.isTTY) {
    return plain;
  }
  const color = prefixColors[index % prefixColors.length];
  return `${color}${plain}\x1b[0m`;
}

function pipeWithPrefix(stream, target, prefix) {
  if (!stream) {
    return;
  }

  const decoder = new StringDecoder('utf8');
  let buffer = '';

  const flushLines = (flushTail = false) => {
    while (buffer.length > 0) {
      const lineBreakIndex = buffer.search(/[\r\n]/);
      if (lineBreakIndex === -1) {
        break;
      }

      const line = buffer.slice(0, lineBreakIndex);
      let consumeLength = 1;
      if (buffer[lineBreakIndex] === '\r' && buffer[lineBreakIndex + 1] === '\n') {
        consumeLength = 2;
      }
      buffer = buffer.slice(lineBreakIndex + consumeLength);
      target.write(`${prefix} ${line}\n`);
    }

    if (flushTail && buffer.length > 0) {
      target.write(`${prefix} ${buffer}\n`);
      buffer = '';
    }
  };

  stream.on('data', (chunk) => {
    buffer += decoder.write(chunk);
    flushLines(false);
  });

  stream.on('end', () => {
    buffer += decoder.end();
    flushLines(true);
  });
}

function resolveBinPath(cwd, packageName, binName) {
  let packageJsonPath;
  try {
    packageJsonPath = require.resolve(`${packageName}/package.json`, { paths: [cwd] });
  } catch {
    throw new Error(`无法解析 ${packageName}，请先执行 pnpm install`);
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const { bin } = packageJson;

  let relativeBinPath = '';
  if (typeof bin === 'string') {
    relativeBinPath = bin;
  } else if (bin && typeof bin === 'object' && typeof bin[binName] === 'string') {
    relativeBinPath = bin[binName];
  } else if (bin && typeof bin === 'object' && Object.keys(bin).length === 1) {
    relativeBinPath = bin[Object.keys(bin)[0]];
  } else {
    throw new Error(`包 ${packageName} 未提供可用 bin: ${binName}`);
  }

  const binPath = path.resolve(path.dirname(packageJsonPath), relativeBinPath);
  if (!existsSync(binPath)) {
    throw new Error(`bin 文件不存在: ${binPath}`);
  }
  return binPath;
}

function logError(message) {
  console.error(`[dev-orchestrator] ${message}`);
}

function killWindowsProcessTree(pid) {
  if (!pid) {
    return;
  }
  const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  killer.on('error', (error) => {
    logError(`taskkill 执行失败 (pid=${pid}): ${error.message}`);
  });
}

function forwardSignal(child, signal) {
  if (!child.pid || child.exitCode !== null) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      child.kill(signal);
      return;
    }
    process.kill(-child.pid, signal);
  } catch (error) {
    logError(`转发 ${signal} 到 pid=${child.pid} 失败: ${error.message}`);
    try {
      child.kill(signal);
    } catch {
      // 忽略兜底 kill 的失败
    }
  }
}

function forceKillRemainingWatchers() {
  for (const { child } of watchers.values()) {
    if (!child.pid || child.exitCode !== null) {
      continue;
    }
    if (process.platform === 'win32') {
      killWindowsProcessTree(child.pid);
      continue;
    }
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // 忽略 SIGKILL 失败
      }
    }
  }
}

function finalizeAndExit() {
  const finalCode = failureCode === 0 ? 0 : failureCode;
  process.exit(finalCode);
}

function beginShutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const { child } of watchers.values()) {
    forwardSignal(child, signal);
  }

  const timeout = setTimeout(() => {
    forceKillRemainingWatchers();
  }, 3000);
  timeout.unref();

  if (watchers.size === 0) {
    finalizeAndExit();
  }
}

function onParentSignal(signal) {
  interruptedByUser = true;
  beginShutdown(signal);
}

process.on('SIGINT', () => {
  onParentSignal('SIGINT');
});

process.on('SIGTERM', () => {
  onParentSignal('SIGTERM');
});

function launchWatcher(spec, index) {
  const cwd = path.resolve(repoRoot, spec.cwd);
  const binPath = resolveBinPath(cwd, spec.packageName, spec.binName);
  const baseEnv = { ...process.env };
  const env = typeof spec.extendEnv === 'function' ? spec.extendEnv(baseEnv) : baseEnv;
  const prefix = formatPrefix(spec, index);

  const child = spawn(process.execPath, [binPath, ...spec.args], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  pipeWithPrefix(child.stdout, process.stdout, prefix);
  pipeWithPrefix(child.stderr, process.stderr, prefix);

  watchers.set(spec.name, { child });

  child.on('error', (error) => {
    if (!shuttingDown) {
      failureCode = 1;
      logError(`${spec.name} 启动失败: ${error.message}`);
      beginShutdown('SIGTERM');
    }
  });

  child.on('exit', (code, signal) => {
    watchers.delete(spec.name);

    if (!shuttingDown) {
      failureCode = code === 0 ? 1 : (code ?? 1);
      const reason = signal ? `signal=${signal}` : `code=${code}`;
      logError(`${spec.name} 异常退出 (${reason})`);
      beginShutdown('SIGTERM');
      return;
    }

    if (!interruptedByUser && failureCode === 0 && code !== 0 && code !== null) {
      failureCode = code;
    }

    if (watchers.size === 0) {
      finalizeAndExit();
    }
  });
}

function main() {
  try {
    watcherSpecs.forEach((spec, index) => {
      launchWatcher(spec, index);
    });
  } catch (error) {
    failureCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    logError(`启动 dev watcher 失败: ${message}`);
    beginShutdown('SIGTERM');
  }
}

main();
