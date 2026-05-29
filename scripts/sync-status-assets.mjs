#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const STATUS_API_BASE_URL = 'https://xivapi-v2.xivcdn.com/api/sheet/Status';
const ASSET_API_BASE_URL = 'https://v2.xivapi.com/api/asset';
const LANGUAGE = 'chs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const statusMapPath = path.join(repoRoot, 'packages/content/status-xivapi-map.json');
const generatedMetadataPath = path.join(
  repoRoot,
  'packages/content/src/generated/status-metadata.ts',
);
const iconOutputDir = path.join(repoRoot, 'apps/web/public/status-icons');

function parseArgs(argv) {
  const options = {
    force: false,
  };

  for (const arg of argv) {
    if (arg === '-f') {
      options.force = true;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`未知参数：${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`用法：node scripts/sync-status-assets.mjs [-f]

同步项目状态元数据并下载图标。

选项：
  -f        强制重新下载所有图标
`);
}

async function readStatusMap() {
  const raw = await readFile(statusMapPath, 'utf8');
  const config = JSON.parse(raw);

  if (
    typeof config !== 'object' ||
    config === null ||
    typeof config.statusXivapiIds !== 'object' ||
    config.statusXivapiIds === null
  ) {
    throw new Error('status-xivapi-map.json 缺少 statusXivapiIds');
  }

  return config;
}

async function readExistingFallbackTextByStatusId() {
  try {
    const source = await readFile(generatedMetadataPath, 'utf8');
    const match = source.match(
      /export const statusMetadataCatalog = ([\s\S]*?) as const satisfies Record<string, StatusMetadata>;/,
    );

    if (match?.[1] === undefined) {
      return {};
    }

    const catalog = vm.runInNewContext(`(${match[1]})`);

    if (typeof catalog !== 'object' || catalog === null) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(catalog)
        .filter(([, metadata]) => typeof metadata?.fallbackText === 'string')
        .map(([statusId, metadata]) => [statusId, metadata.fallbackText]),
    );
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

function buildStatusUrl(xivapiStatusId) {
  return `${STATUS_API_BASE_URL}/${xivapiStatusId}?language=${LANGUAGE}`;
}

function buildAssetUrl(iconPath) {
  const params = new URLSearchParams({
    path: iconPath,
    format: 'png',
  });

  return `${ASSET_API_BASE_URL}?${params.toString()}`;
}

function createFallbackText(name) {
  return Array.from(name.trim()).slice(0, 2).join('') || '??';
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`请求失败：${response.status} ${response.statusText} ${url}`);
  }

  return response.json();
}

async function fetchStatusMetadata(statusId, xivapiStatusId, fallbackTextByStatusId) {
  const url = buildStatusUrl(xivapiStatusId);
  const payload = await fetchJson(url);
  const fields = payload.fields;
  const name = fields?.Name;
  const description = fields?.Description;
  const icon = fields?.Icon;
  const partyListPriority = fields?.PartyListPriority;

  if (
    typeof name !== 'string' ||
    typeof description !== 'string' ||
    typeof icon?.id !== 'number' ||
    typeof icon?.path !== 'string' ||
    typeof partyListPriority !== 'number'
  ) {
    throw new Error(`Status/${xivapiStatusId} 返回字段不完整，项目状态：${statusId}`);
  }

  return {
    id: statusId,
    name,
    description,
    xivapiStatusId,
    iconId: icon.id,
    iconPath: icon.path,
    iconUrl: `/status-icons/${icon.id}.png`,
    fallbackText: fallbackTextByStatusId[statusId] ?? createFallbackText(name),
    partyListPriority,
  };
}

async function fileExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function downloadIcon(metadata, options) {
  const iconPath = path.join(iconOutputDir, `${metadata.iconId}.png`);

  if (!options.force && (await fileExists(iconPath))) {
    console.log(`跳过已有图标：${metadata.id} -> ${metadata.iconUrl}`);
    return;
  }

  const response = await fetch(buildAssetUrl(metadata.iconPath));

  if (!response.ok || response.body === null) {
    throw new Error(
      `图标下载失败：${response.status} ${response.statusText} ${metadata.id} ${metadata.iconPath}`,
    );
  }

  await mkdir(iconOutputDir, { recursive: true });

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(iconPath, buffer);

  console.log(`已下载图标：${metadata.id} -> ${metadata.iconUrl}`);
}

function formatGeneratedMetadata(metadataByStatusId) {
  const body = JSON.stringify(metadataByStatusId, null, 2);

  return `import type { StatusMetadata } from '@ff14arena/shared';

export const statusMetadataCatalog = ${body} as const satisfies Record<string, StatusMetadata>;
`;
}

async function formatTypeScript(source) {
  try {
    const prettier = await import('prettier');
    const config = await prettier.resolveConfig(generatedMetadataPath);
    return prettier.format(source, {
      ...config,
      parser: 'typescript',
      singleQuote: true,
    });
  } catch {
    return source;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = await readStatusMap();
  const fallbackTextByStatusId = await readExistingFallbackTextByStatusId();
  const entries = Object.entries(config.statusXivapiIds);
  const metadataByStatusId = {};

  await mkdir(path.dirname(generatedMetadataPath), { recursive: true });
  await mkdir(iconOutputDir, { recursive: true });

  for (const [statusId, xivapiStatusId] of entries) {
    if (!Number.isInteger(xivapiStatusId)) {
      throw new Error(`状态 ${statusId} 的 XIVAPI ID 不是整数`);
    }

    const metadata = await fetchStatusMetadata(statusId, xivapiStatusId, fallbackTextByStatusId);
    metadataByStatusId[statusId] = metadata;
    await downloadIcon(metadata, options);
  }

  await writeFile(
    generatedMetadataPath,
    await formatTypeScript(formatGeneratedMetadata(metadataByStatusId)),
    'utf8',
  );
  console.log(`已写入状态元数据：${path.relative(repoRoot, generatedMetadataPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
