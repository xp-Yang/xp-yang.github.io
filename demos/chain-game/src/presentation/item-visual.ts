import { GEM_ICON_URL } from './gem-visual';
import { pixelIcon } from './pixel-icons';

export const SHIELD_ICON_URL = new URL('../assets/items/shield.png', import.meta.url).href;
export const POTION_ATLAS_URL = new URL('../assets/items/potions.png', import.meta.url).href;

const POTION_ROWS: Readonly<Record<string, number>> = {
  teleport: 0,
  'combo-3': 5,
  'combo-5': 6,
  'combo-10': 7,
};

/** Decorative, locally bundled artwork. The enclosing control supplies its name. */
export function itemIcon(kind: string): string {
  const row = Object.prototype.hasOwnProperty.call(POTION_ROWS, kind)
    ? POTION_ROWS[kind]
    : undefined;
  if (row !== undefined) {
    const bonus = kind.startsWith('combo-') ? kind.slice(6) : '';
    return `<span class="item-art item-art--potion item-art--${kind}" aria-hidden="true"><span class="item-potion-frames" style="--potion-row:${row};background-image:url('${POTION_ATLAS_URL}')"></span>${bonus ? `<span class="item-art-number">+${bonus}</span>` : ''}</span>`;
  }
  if (kind === 'shield') {
    return `<span class="item-art item-art--shield" aria-hidden="true"><img class="pixel-art" src="${SHIELD_ICON_URL}" alt="" draggable="false"></span>`;
  }
  if (kind === 'double-gems') {
    return `<span class="item-art item-art--double-gems" aria-hidden="true"><img class="pixel-art" src="${GEM_ICON_URL}" alt="" draggable="false"><span class="item-art-number">×2</span></span>`;
  }
  if (kind === 'heal-1' || kind === 'heal-2') {
    return `<span class="item-art item-art--${kind}" aria-hidden="true">${pixelIcon('heart')}${kind === 'heal-2' ? pixelIcon('heart') : ''}</span>`;
  }
  return '<span class="item-art" aria-hidden="true"></span>';
}
