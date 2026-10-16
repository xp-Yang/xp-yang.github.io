import type { ItemKind } from '../core/model';
import { nextRandom } from '../core/random';

export type ShopOfferId =
  | 'heal-1'
  | 'heal-2'
  | 'double-gems'
  | 'shield'
  | 'teleport'
  | 'combo-3'
  | 'combo-5'
  | 'combo-10';

export interface ShopOffer {
  id: ShopOfferId;
  name: string;
  price: number;
  description: string;
  item?: ItemKind;
  healing?: number;
}

export const SHOP_REFRESH_PRICE = 5;

export const SHOP_OFFERS: readonly ShopOffer[] = [
  { id: 'heal-1', name: '回复生命', price: 5, healing: 1, description: '立即回复 1 点生命。' },
  { id: 'heal-2', name: '回复生命', price: 10, healing: 2, description: '立即回复 2 点生命，最高 3 点。' },
  { id: 'double-gems', name: '双倍宝石', price: 10, description: '下一关拾取宝石的数量 ×2。' },
  { id: 'shield', name: '护盾', price: 25, item: 'shield', description: '自动抵挡一次路线结束后的全部攻击，使用后销毁。' },
  { id: 'teleport', name: '瞬移药水', price: 25, item: 'teleport', description: '瞬移至一个水果或宝石的位置；原地内容交换，不推进回合。' },
  { id: 'combo-3', name: '连击药水 +3', price: 15, item: 'combo-3', description: '下一次执行路线增加 3 连击，使用后消耗。' },
  { id: 'combo-5', name: '连击药水 +5', price: 25, item: 'combo-5', description: '下一次执行路线增加 5 连击，使用后消耗。' },
  { id: 'combo-10', name: '连击药水 +10', price: 50, item: 'combo-10', description: '下一次执行路线增加 10 连击，使用后消耗。' },
];

export interface ShopState {
  runId: string;
  nextLevelId: string;
  offers: ShopOfferId[];
  purchased: ShopOfferId[];
  rng: number;
  refreshCount: number;
  closed: boolean;
}

export function isShopOfferId(value: unknown): value is ShopOfferId {
  return SHOP_OFFERS.some((offer) => offer.id === value);
}

export function getShopOffer(id: ShopOfferId): ShopOffer {
  const offer = SHOP_OFFERS.find((candidate) => candidate.id === id);
  if (!offer) throw new Error('商品不存在。');
  return offer;
}

/** The shop has its own saved stream, independent of combat and board rolls. */
export function drawShopOffers(rng: number): { offers: ShopOfferId[]; rng: number } {
  const available = SHOP_OFFERS.map((offer) => offer.id);
  const offers: ShopOfferId[] = [];
  while (offers.length < 3) {
    const result = nextRandom(rng);
    rng = result.state;
    const [offer] = available.splice(Math.floor(result.value * available.length), 1);
    offers.push(offer);
  }
  return { offers, rng };
}
