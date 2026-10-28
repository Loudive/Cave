/**
 * RunState.ts — шаг 12: перенос состояния забега между слоями пещеры.
 *
 * РАКЕЦА шага 11 (баг от пользователя): при спуске через врата сцена
 * рестартует (scene.restart) — create() делал new Vitals() и new Mutations(),
 * и существо «рожддалось заново»: уровень, опыт, счётчик съеденных, диета,
 * мутации и спутник терялись на каждом переходе. Пользователь: «при переходе
 * в другую пещеру скидывается количество роста и съеденных».
 *
 * Решение: перед рестартом сцена снимает снапшот забега и передаёт его
 * в SceneData следующего слоя. Слои — та же жизнь, тот же забег.
 */

/** Снимок Vitals, который живёт между слоями одной пещеры. */
export interface VitalsSnapshot {
  hp: number
  maxHp: number
  hunger: number
  maxHunger: number
  xp: number
  level: number
  eatenCount: number
  mutationsCount: number
}

/** Полный снимок забега для переноса через scene.restart. */
export interface RunSnapshot {
  vitals: VitalsSnapshot
  /** id мутаций забега (эффекты переигрываются тихо, без баннеров). */
  mutationIds: string[]
  /** Диета по видам (экран итога: «съедено добычи — …»). */
  eatenBySpecies: Record<string, number>
  /** Гены, поднятые за забег (итоговый экран). */
  genesGained: string[]
  /** Спутник «Мать-корона» жил на прошлом слое — вернуть его. */
  companion: boolean
}
