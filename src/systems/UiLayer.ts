import Phaser from 'phaser'
import { RENDER_SCALE } from './RenderScale'

/**
 * UiLayer — шаг 20: экран-слой HUD при зуме камеры.
 *
 * Жалоба игрока: «приблизь камеру в два раза — хочу ближе видеть
 * персонажа». Камера пещеры теперь живёт с базовым зумом (vfx.json
 * cameraBaseZoom), но зум камеры в Phaser масштабирует ВСЁ, что она
 * рендерит — включая scrollFactor(0)-объекты (HUD отъезжал к краям
 * и рос в 2 раза). Решение: весь экранный UI кладётся в ОДИН
 * контейнер uiRoot (scrollFactor 0), а каждый кадр uiRootSyncZoom
 * вешает на него контр-трансформацию, гасящую зум.
 *
 * Матрица камеры (preRender): зум применяется вокруг центра экрана C,
 * точка сцены p рендерится на экране как S = z·(p − scroll·sf − C) + C.
 * Контейнер на позиции P с масштабом s рендерит ребёнка (x, y) в
 * S = z·(P + s·x − C) + C. Чтобы S ≡ x (тождественная единица), нужно
 * s = 1/z и P = C·(1 − 1/z) — что uiRootSyncZoom и делает. При зуме 1
 * контр-трансформация вырождается в ноль (P=0, s=1) — как раньше.
 *
 * Внутри uiRoot объекты живут в ЭКРАННЫХ координатах (как до зума),
 * твины уведомлений (y: 78 и т.п.) работают без изменений. Краткий
 * пульс slow-mo (zoomTo) тоже гасится — каждый кадр.
 *
 * Порядок отрисовки внутри контейнера = порядок добавления, поэтому
 * uiAttach вставляет объект по его depth (сортировка вставкой) —
 * относительные глубины HUD сохраняются (вигнетка 18 → HUD 22 →
 * debug 24 → мини-карта 30/38 → оверлей смерти 40).
 *
 * Слой глубины uiRoot: 46 — выше всего мирового (маска 14, мошь 16,
 * числа урона 19, оверлеи 40). Символьный ключ вместо поля класса:
 * Hud/MiniMap/Mutations/DebugOverlay/FpsGuard получают scene как
 * Phaser.Scene — без импорта CaveScene (и без циклов в рантайме).
 */

const UI_ROOT = Symbol('caveUiRoot')

/** Создать корневой контейнер экрана (один раз в CaveScene.create). */
export function createUiRoot(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const root = scene.add.container(0, 0)
    .setScrollFactor(0)
    .setDepth(46)
  ;(scene as unknown as Record<symbol, Phaser.GameObjects.Container>)[UI_ROOT] = root
  return root
}

/** Положить объект в экран-слой, сохраняя порядок по depth. */
export function uiAttach(scene: Phaser.Scene, obj: Phaser.GameObjects.GameObject): void {
  const root = (scene as unknown as Record<symbol, Phaser.GameObjects.Container>)[UI_ROOT]
  if (!root) return
  const d = (obj as { depth?: number }).depth ?? 0
  const list = root.list
  let i = list.length
  while (i > 0 && ((list[i - 1] as { depth?: number }).depth ?? 0) > d) i--
  if (i >= list.length) root.add(obj)
  else root.addAt(obj, i)
}

/** Контр-трансформация экран-слоя против текущего зума (каждый кадр). */
export function uiRootSyncZoom(scene: Phaser.Scene): void {
  const root = (scene as unknown as Record<symbol, Phaser.GameObjects.Container>)[UI_ROOT]
  if (!root) return
  const z = scene.cameras.main.zoom
  if (!Number.isFinite(z) || z <= 0) return
  // Шаг 23: канвас живёт в 960k×540k (backing px), а координаты детей
  // uiRoot — в ДИЗАЙН-пикселях 960×540. Итоговый масштаб слоя = k/z:
  // экранная позиция ребёнка (x,y) = k·(x,y) — ровно как выглядел HUD
  // до рендер-масштаба, но в k раз плотнее. Формула позиции не меняется
  // (выведена для тождества S≡x при s=1/z; при s=k/z даёт S≡k·x,
  // C = центр канваса в его собственных px = 480k/270k).
  if (z === 1) {
    root.setPosition(0, 0).setScale(RENDER_SCALE)
    return
  }
  const cx = scene.scale.width / 2
  const cy = scene.scale.height / 2
  root.setPosition(cx * (1 - 1 / z), cy * (1 - 1 / z)).setScale(RENDER_SCALE / z)
}
