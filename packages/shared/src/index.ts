export const PARTY_SLOT_ORDER = ['MT', 'ST', 'H1', 'H2', 'D1', 'D2', 'D3', 'D4'] as const;

export type PartySlot = (typeof PARTY_SLOT_ORDER)[number];
