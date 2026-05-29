import type { OperationMode } from './ui';

const OPERATION_MODE_STORAGE_KEY = 'ff14arena:operation-mode';

export function loadOperationMode(): OperationMode {
  const raw = window.localStorage.getItem(OPERATION_MODE_STORAGE_KEY);

  if (raw === 'standard' || raw === 'fixed') {
    return raw;
  }

  return 'traditional';
}

export function saveOperationMode(operationMode: OperationMode): void {
  window.localStorage.setItem(OPERATION_MODE_STORAGE_KEY, operationMode);
}
