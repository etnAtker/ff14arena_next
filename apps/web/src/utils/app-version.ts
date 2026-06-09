export interface AppChangelogEntry {
  version: string;
  title: string;
  items: string[];
}

export interface AppVersionConfig {
  version: string;
  changelog: AppChangelogEntry[];
}

const APP_VERSION_CONFIG_URL = '/app-version.json';
const APP_VERSION_STORAGE_KEY = 'ff14arena.appVersion';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeChangelogEntry(value: unknown): AppChangelogEntry | null {
  if (!isRecord(value) || typeof value.version !== 'string') {
    return null;
  }

  const items = Array.isArray(value.items)
    ? value.items.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    version: value.version,
    title: typeof value.title === 'string' ? value.title : value.version,
    items,
  };
}

function normalizeAppVersionConfig(value: unknown): AppVersionConfig | null {
  if (!isRecord(value) || typeof value.version !== 'string' || !Array.isArray(value.changelog)) {
    return null;
  }

  const changelog = value.changelog
    .map((entry) => normalizeChangelogEntry(entry))
    .filter((entry): entry is AppChangelogEntry => entry !== null)
    .sort((a, b) => b.version.localeCompare(a.version));

  return {
    version: value.version,
    changelog,
  };
}

export async function loadAppVersionConfig(): Promise<AppVersionConfig | null> {
  const response = await window.fetch(APP_VERSION_CONFIG_URL, { cache: 'no-store' });

  if (!response.ok) {
    return null;
  }

  return normalizeAppVersionConfig(await response.json());
}

export function loadCachedAppVersion(): string | null {
  return window.localStorage.getItem(APP_VERSION_STORAGE_KEY);
}

export function saveCachedAppVersion(version: string): void {
  window.localStorage.setItem(APP_VERSION_STORAGE_KEY, version);
}

export function getPendingChangelogEntries(
  config: AppVersionConfig,
  cachedVersion: string | null,
): AppChangelogEntry[] {
  if (cachedVersion === config.version) {
    return [];
  }

  if (cachedVersion === null) {
    return config.changelog;
  }

  const pendingEntries = config.changelog.filter((entry) => entry.version > cachedVersion);
  return pendingEntries.length > 0 ? pendingEntries : config.changelog;
}
