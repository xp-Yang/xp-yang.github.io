import manifest from '../assets/fruit/manifest.json';
import type { ColorId } from '../core';

export type FruitId = keyof typeof manifest.rects;

export interface FruitSpriteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FRUIT_ATLAS_URL = new URL('../assets/fruit/fruit.png', import.meta.url).href;
export const FRUIT_RECTS: Readonly<Record<FruitId, FruitSpriteRect>> = manifest.rects;

export const FRUIT_BY_COLOR: Readonly<Record<ColorId, FruitId>> = {
  blue: 'orange',
  green: 'pear',
  purple: 'blackberry',
  red: 'apple',
};

export const FRUIT_NAMES: Readonly<Record<FruitId, string>> = {
  apple: '苹果',
  banana: '香蕉',
  blackberry: '黑莓',
  cherry: '樱桃',
  coconut: '椰子',
  lemon: '柠檬',
  mango: '芒果',
  orange: '橙子',
  pear: '梨',
  pineapple: '菠萝',
  strawberry: '草莓',
  watermelon: '西瓜',
};
