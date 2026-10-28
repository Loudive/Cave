/**
 * unwrap.ts — generic unwrapper for configs of the {key: {_doc, value}} format.
 *
 * Why this exists (the rake of step 10, bit us twice): the config vfx.json was
 * translated to a format with _doc-documentation, but the typed access remained
 * `data as unknown as Config` — as a result, VFX.flashPoolSize turned out to be
 * an OBJECT instead of the number 6. Comparison `0 < {…}` is always false, the
 * flash pool was not populated, `undefined.setPosition` threw an exception inside
 * the scene step — and Phaser never scheduled the next rAF: the game froze dead
 * after the first carcass chew.
 *
 * Rule now: any config with _doc wrapper MUST go through unwrapDoc() — it unwraps
 * values and VALIDATES the shape at boot (fail-fast with a clear message), instead
 * of silently leaking NaN into tweens/shaders at gameplay time.
 */

interface DocLeaf<T> {
  _doc?: string
  value: T
}

interface DocNode {
  _doc?: string
  [key: string]: unknown
}

/** Number keys that must be finite after unwrapping (validated in assertNumbers). */
export type NumberKeys<T> = {
  [K in keyof T]: T[K] extends number ? K : never
}[keyof T]

/**
 * Unwrap {key: {_doc, value}} → {key: value} recursively.
 * Objects without a `value` leaf are treated as nested nodes and recursed;
 * primitives and arrays are copied as-is (arrays of presets in audio.json).
 */
export function unwrapDoc<T>(data: DocNode, configName: string): T {
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(data)) {
    if (key === '_doc') continue
    const isObj = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    if (isObj && 'value' in (raw as Record<string, unknown>)) {
      out[key] = (raw as DocLeaf<unknown>).value
    } else if (isObj) {
      out[key] = unwrapDoc(raw as DocNode, `${configName}.${key}`)
    } else {
      out[key] = raw
    }
  }
  return out as T
}

/**
 * Fail-fast check: every listed key must be a finite number.
 * Catches the «_doc wrapper leaked into a flat-typed access» class of bugs
 * at boot with a clear message, instead of NaN deep inside the engine.
 */
export function assertNumbers<T>(cfg: T, configName: string, keys: readonly NumberKeys<T>[]): void {
  for (const key of keys) {
    const v = cfg[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(
        `${configName}: поле «${String(key)}» = ${JSON.stringify(v)} — ожидалось конечное число. ` +
          `Конфиг сломан (_doc-обёртка не развёрнута или лист не number) — дальше запускать бессмысленно.`,
      )
    }
  }
}
