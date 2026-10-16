import type { ItemKind, RunState } from './model';

export const MAX_ITEMS = 3;
export const ITEM_KINDS: readonly ItemKind[] = [
  'shield',
  'teleport',
  'combo-3',
  'combo-5',
  'combo-10',
];

export function isItemKind(value: unknown): value is ItemKind {
  return typeof value === 'string' && ITEM_KINDS.includes(value as ItemKind);
}

export function itemComboBonus(item: ItemKind | undefined): number {
  if (item === 'combo-3') return 3;
  if (item === 'combo-5') return 5;
  if (item === 'combo-10') return 10;
  return 0;
}

export function comboBonus(
  state: Pick<RunState, 'inventory' | 'selectedComboIndex'>,
): number {
  const index = state.selectedComboIndex;
  if (index === undefined || !Number.isInteger(index) || index < 0) return 0;
  return itemComboBonus(state.inventory?.[index]);
}
