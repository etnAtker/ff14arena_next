export interface LocalProfile {
  userId: string;
  userName: string;
  legacyProtocolMode: boolean;
}

const PROFILE_STORAGE_KEY = 'ff14arena:profile';

function createDefaultProfile(): LocalProfile {
  return {
    userId: `user_${crypto.randomUUID()}`,
    userName: `玩家${Math.floor(Math.random() * 9000 + 1000)}`,
    legacyProtocolMode: false,
  };
}

export function loadProfile(): LocalProfile {
  const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);

  if (raw === null) {
    const nextProfile = createDefaultProfile();
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
    return nextProfile;
  }

  try {
    const parsed = JSON.parse(raw) as LocalProfile;

    if (typeof parsed.userId === 'string' && typeof parsed.userName === 'string') {
      const normalizedProfile = {
        userId: parsed.userId,
        userName: parsed.userName,
        legacyProtocolMode: parsed.legacyProtocolMode === true,
      };
      window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(normalizedProfile));
      return normalizedProfile;
    }
  } catch {
    // 忽略损坏的本地缓存，回退到默认身份。
  }

  const fallback = createDefaultProfile();
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(fallback));
  return fallback;
}

export function saveProfile(profile: LocalProfile): void {
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}
