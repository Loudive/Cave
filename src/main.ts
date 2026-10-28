import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'
import { MenuScene } from './scenes/MenuScene'
import { CaveScene } from './scenes/CaveScene'

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
  scene: [BootScene, MenuScene, CaveScene],
}

const game = new Phaser.Game(config)

// Отладочный хендл: используется агентом для автотестов (agent-browser).
declare global {
  interface Window {
    __GAME__?: Phaser.Game
  }
}
window.__GAME__ = game

export default game
