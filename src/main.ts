import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'
import { MenuScene } from './scenes/MenuScene'
import { CaveScene } from './scenes/CaveScene'
import { NestScene } from './scenes/NestScene'

/**
 * Cave Devourer — точка входа.
 * Палитра проекта (см. design/DECISIONS.md):
 *   #0B0B10 — полотно пещеры, #58E6C8 — биолюм-циан, #E23A4E — кровь,
 *   #B36BFF — споры, #A8E34F — кислота, #E8E6E3 — текст/UI.
 */
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: 960,
  height: 540,
  backgroundColor: '#0B0B10',
  // Шаг 10 (перфоманс): просим дискретный GPU, где он есть; пиксельные
  // координаты без сглаживания субпикселей (арт — пиксельный, 16px тайлы).
  powerPreference: 'high-performance',
  roundPixels: true,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, CaveScene, NestScene],
}

const game = new Phaser.Game(config)

// ── Шаг 13: страховка всего игрового цикла ────────────────────────────────────
//
// Рейк (третий за проект): исключение, брошенное ЛЮБЫМ коллбеком внутри кадра
// (твины, таймеры, эффекты камеры, физика — всё, что Phaser зовёт из
// Systems.step/Timestep.step), вырывается наружу — а RAF-объект Phaser
// перевыставляет requestAnimationFrame ПОСЛЕ коллбека. Значит, любое такое
// исключение убивает rAF-цепочку НАВСЕГДА: экран застывает последним кадром
// (у пользователя — оранжевым, посреди глубинного биома).
//
// Страховка scene.update (шаг 11) закрывала только свой кусок кадра. Здесь
// мы оборачиваем САМ коллбек RAF: исключение любой системы логируется
// (консоль + __ERRS__ для автотестов, с троттлингом) и ПРОГЛАТЫВАЕТСЯ —
// кадр считается потерянным, но мир живёт дальше. Это «дорогое» решение:
// одна обёртка закрывает весь класс зависаний разом.
const errs = (window as unknown as { __ERRS__?: string[] })
if (!errs.__ERRS__) errs.__ERRS__ = []

// RAF-коллбек выставляется в Game.start() ПОСЛЕ события READY — поэтому
// не привязываемся к порядку boot, а тихо опрашиваем до его появления
// (пара-тройка итераций по 50 мс) и сразу оборачиваем.
function installLoopWatchdog(): boolean {
  const loop = game.loop as unknown as {
    raf?: { callback?: (time: number) => void; step?: unknown }
  }
  const raf = loop.raf
  if (!raf || typeof raf.callback !== 'function') return false
  const original = raf.callback
  let lastLogAt = 0
  let swallowed = 0
  raf.callback = (time: number): void => {
    try {
      original(time)
    } catch (err) {
      swallowed++
      const now = Date.now()
      if (now - lastLogAt > 1000) {
        lastLogAt = now
        const msg = `loop-watchdog: кадр #${game.loop.frame} проглочен (всего ${swallowed}): ` +
          `${err instanceof Error ? err.message : String(err)}`
        console.error(msg, err)
        errs.__ERRS__!.push(msg)
      }
    }
  }
  return true
}

if (!installLoopWatchdog()) {
  let tries = 0
  const timer = window.setInterval(() => {
    if (installLoopWatchdog() || ++tries > 100) window.clearInterval(timer)
  }, 50)
}

// WebGL-контекст: браузер может отобрать GPU (фон вкладки, драйвер). Phaser
// не восстанавливает контекст сам — честно сообщаем и предлагаем перезагрузку.
game.events.once(Phaser.Core.Events.READY, () => {
  const canvas = game.canvas
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    errs.__ERRS__!.push('webgl: контекст потерян — рендер мёртв, нужен reload')
    console.error('[cave] WebGL-контекст потерян — перезагрузи страницу')
    if (document.getElementById('ctx-lost')) return
    const box = document.createElement('div')
    box.id = 'ctx-lost'
    box.textContent = 'ГРАФИКА ПОТЕРЯНА — перезагрузить'
    box.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;'
      + 'background:#0B0B10;color:#58E6C8;font:bold 20px monospace;z-index:99;cursor:pointer'
    box.addEventListener('click', () => location.reload())
    document.body.appendChild(box)
  })
})

// Отладочный хендл: используется агентом для автотестов (agent-browser).
declare global {
  interface Window {
    __GAME__?: Phaser.Game
  }
}
window.__GAME__ = game

export default game
