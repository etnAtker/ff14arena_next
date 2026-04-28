import type { OperationMode } from './ui';

const OPERATION_MODE_STORAGE_KEY = 'ff14arena:operation-mode';

export function loadOperationMode(): OperationMode {
  const raw = window.localStorage.getItem(OPERATION_MODE_STORAGE_KEY);
  return raw === 'standard' ? 'standard' : 'traditional';
}

export function saveOperationMode(operationMode: OperationMode): void {
  window.localStorage.setItem(OPERATION_MODE_STORAGE_KEY, operationMode);
}
