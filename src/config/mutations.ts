/**
 * mutations.ts — типизированный доступ к пулу забеговых мутаций.
 * Источник правды — src/config/mutations.json (шаг 6, структура — под шаг 8).
 */
import data from './mutations.json'

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic'

export type MutationEffect =
  | { type: 'grip'; wallSlideMult: number }
  | { type: 'digestion'; mult: number }
  | { type: 'biteDamage'; mult: number; acid?: boolean }
  | { type: 'doubleJump'; airJumps: number }
  | { type: 'thorns'; damage: number }
  | { type: 'stealth'; detectMult: number }
  | { type: 'stunBite'; stunMs: number }
  | { type: 'secondHeart' }

export interface MutationDef {
  id: string
  name: string
  rarity: Rarity
  weight: number
  desc: string
  effect: MutationEffect
}

export interface MutationsConfig {
  rarityColors: Record<Rarity, string>
  pool: MutationDef[]
}

export const MUTATIONS = data as unknown as MutationsConfig
