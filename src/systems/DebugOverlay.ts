import Phaser from 'phaser'
import { Creature } from '../entities/Creature'
import { uiAttach } from './UiLayer'

/**
 * DebugOverlay — шаг 3: оверлей состояния существа.
 * Показывает состояние, скорости, coyote/buffer таймеры и FPS.
 * Переключение — F3. Помогает «чувствовать» параметры movement.json.
 * С шага 4 — принимает опциональные строки о пещере (seed, связность…).
 * Шаг 10 (перфоманс): по умолчанию ВЫКЛЮЧЕН — setText перерисовывает
 * канву-текстуру каждый кадр (мс CPU), в релизе игрокам это не нужно.
 * Выбор сохраняется в localStorage ('cave-debug').
 */
export class DebugOverlay {
  private readonly text: Phaser.GameObjects.Text
  private visible: boolean

  constructor(
    scene: Phaser.Scene,
    private creature: Creature,
    private extra?: () => string[],
  ) {
    this.text = scene.add.text(12, 12, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#58E6C8',
      backgroundColor: 'rgba(11,11,16,0.72)',
      padding: { x: 8, y: 6 },
      lineSpacing: 3,
    })
      .setScrollFactor(0)
      .setDepth(20)
    // Шаг 20: дебаг-текст — экранным слоем (не зумится с камерой).
    uiAttach(scene, this.text)

    try {
      this.visible = localStorage.getItem('cave-debug') === '1'
    } catch {
      this.visible = false
    }
    this.text.setVisible(this.visible)

    scene.input.keyboard?.on('keydown-F3', () => {
      this.visible = !this.visible
      this.text.setVisible(this.visible)
      try {
        localStorage.setItem('cave-debug', this.visible ? '1' : '0')
      } catch {
        /* приватный режим */
      }
    })
  }

  update(scene: Phaser.Scene): void {
    if (!this.visible) return

    const body = this.creature.body as Phaser.Physics.Arcade.Body
    const now = scene.time.now
    const fps = Math.round(scene.game.loop.actualFps)
    const state = this.creature.getState()

    // Цвет состояния: зелёный — «ок», фиолетовый — стены, циан — глайд.
    const stateColor: Record<string, string> = {
      'ground': '#A8E34F',
      'jump': '#E8E6E3',
      'fall': '#E8E6E3',
      'wall-slide': '#B36BFF',
      'glide': '#58E6C8',
      'wall-lock': '#E23A4E',
    }

    const wall = this.creature.wallSide < 0 ? '<-' : this.creature.wallSide > 0 ? '->' : '.'
    const lines = [
      `state:  ${state}`,
      `speed:  vx=${Math.round(body.velocity.x).toString().padStart(4)}  vy=${Math.round(body.velocity.y).toString().padStart(4)}`,
      `floor:  ${this.creature.onFloor ? 'yes' : 'no '}   wall: ${wall}`,
      `coyote: ${Math.round(this.creature.coyoteLeft(now)).toString().padStart(3)}ms  buffer: ${Math.round(this.creature.jumpBufferLeft(now)).toString().padStart(3)}ms`,
      `fps:    ${fps}`,
      ...(this.extra ? this.extra() : []),
    ]
    this.text.setText(lines)
    this.text.setColor(stateColor[state] ?? '#E8E6E3')
  }
}
