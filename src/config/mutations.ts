/**
 * mutations.ts — типизированный доступ к пулу забеговых мутаций.
 * Источник правды — src/config/mutations.json (шаг 6, структура — под шаг 8).
 */
import data from './mutations.json'

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'curse'

export type MutationEffect =
  | { type: 'grip'; wallSlideMult: number }
  | { type: 'digestion'; mult: number }
  | { type: 'biteDamage'; mult: number; acid?: boolean }
  | { type: 'doubleJump'; airJumps: number }
  | { type: 'thorns'; damage: number }
  | { type: 'stealth'; detectMult: number }
  | { type: 'stunBite'; stunMs: number }
  | { type: 'secondHeart' }
  // ── Шаг 8: расширение пула до 20 геномов ──
  | { type: 'sporeBreath' }
  | { type: 'gluttonMaw'; digestMult: number; appetiteMult: number }
  | { type: 'echoPulse' }
  | { type: 'bloodRush'; speedMult: number; boostMs: number }
  | { type: 'parasiteSaliva'; dps: number; durationMs: number }
  | { type: 'bonePlate'; mult: number }
  | { type: 'nightVision'; lightMult: number }
  | { type: 'spikeMane'; damageMult: number }
  | { type: 'lightHungerCore'; lightMult: number; dmgMult: number }
  | { type: 'motherCrown' }
  | { type: 'hungryVeins'; hungerMult: number; dmgMult: number }
  | { type: 'transparentSkin'; detectMult: number; hpPct: number }

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
