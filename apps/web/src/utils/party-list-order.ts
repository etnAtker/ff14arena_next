import { PARTY_SLOT_ORDER, type PartySlot } from '@ff14arena/shared';

const PARTY_LIST_ORDER_STORAGE_KEY = 'ff14arena:party-list-order';

function isPartySlot(value: unknown): value is PartySlot {
  return typeof value === 'string' && (PARTY_SLOT_ORDER as readonly string[]).includes(value);
}

function normalizePartyListOrder(value: unknown): PartySlot[] | null {
  if (!Array.isArray(value) || value.length !== PARTY_SLOT_ORDER.length) {
    return null;
  }

  const slots = value.filter(isPartySlot);

  if (slots.length !== PARTY_SLOT_ORDER.length) {
    return null;
  }

  const uniqueSlots = new Set(slots);

  if (uniqueSlots.size !== PARTY_SLOT_ORDER.length) {
    return null;
  }

  return [...slots];
}

export function loadPartyListOrder(): PartySlot[] {
  const raw = window.localStorage.getItem(PARTY_LIST_ORDER_STORAGE_KEY);

  if (raw === null) {
    return [...PARTY_SLOT_ORDER];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizePartyListOrder(parsed);

    if (normalized !== null) {
      return normalized;
    }
  } catch {
    // 忽略损坏的本地排序缓存，回退到默认顺序。
  }

  return [...PARTY_SLOT_ORDER];
}

export function savePartyListOrder(order: PartySlot[]): void {
  const normalized = normalizePartyListOrder(order);

  if (normalized === null) {
    return;
  }

  window.localStorage.setItem(PARTY_LIST_ORDER_STORAGE_KEY, JSON.stringify(normalized));
}
