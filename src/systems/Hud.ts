import Phaser from 'phaser'
import { BALANCE } from '../config/balance'
import { QUALITY } from './quality'
import { rarityColor, type Mutations } from './Mutations'
import type { Vitals } from './Vitals'

/**
 * Hud — шаг 6: состояние хищника.
 * HP (кровавый) с «призрачным» белым следом урона, голод (мясной
 * янтарь), тонкая полоса роста (споровый фиолет), иконки мутаций,
 * тумблер качества (Q). На тач-устройствах — кнопка укуса.
 * Всё рисуется Graphics'ом за кадр — дешевле пачки спрайтов.
 */
const DEPTH_HUD = 22

const BAR_X = 16
const BAR_Y = 14
const BAR_W = 150
const BAR_H = 10

export class Hud {
  private gfx: Phaser.GameObjects.Graphics
  private levelText: Phaser.GameObjects.Text
  private qualityText: Phaser.GameObjects.Text
  private mutationIcons: Phaser.GameObjects.Image[] = []
  private ghostHp = 1
  private hungerPulse = 0

  constructor(
    private scene: Phaser.Scene,
    private vitals: Vitals,
    private mutations: Mutations,
    private onBiteButton: () => void,
  ) {
    this.gfx = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH_HUD)
    this.levelText = scene.add.text(BAR_X, BAR_Y + BAR_H + 16, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#B36BFF',
    }).setScrollFactor(0).setDepth(DEPTH_HUD)

    this.qualityText = scene.add.text(0, 0, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#8A8894',
    }).setScrollFactor(0).setDepth(DEPTH_HUD).setOrigin(1, 1)
    // Правый нижний угол, на строке подсказок управления (мини-карта выше).
    this.qualityText.setPosition(scene.scale.width - 10, scene.scale.height - 2)
    this.refreshQualityText()

    scene.input.keyboard?.on('keydown-Q', () => {
      QUALITY.toggle()
      this.refreshQualityText()
    })

    if (this.isTouch()) this.buildBiteButton()
  }

  private isTouch(): boolean {
    return this.scene.sys.game.device.input.touch && window.matchMedia('(pointer: coarse)').matches
  }

  /** Кнопка укуса (мобилки): справа снизу, большой тач-таргет ≥44px. */
  private buildBiteButton(): void {
    const w = this.scene.scale.width
    const h = this.scene.scale.height
    const r = 34
    const circle = this.scene.add.circle(w - 52, h - 60, r, 0xe23a4e, 0.22)
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD)
      .setStrokeStyle(2, 0xe23a4e, 0.65)
    const label = this.scene.add.text(w - 52, h - 60, 'УКУС', {
      fontFamily: 'monospace',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#E23A4E',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH_HUD + 1)

    circle.setInteractive({ useHandCursor: true })
    circle.on(Phaser.Input.Events.POINTER_DOWN, () => {
      this.onBiteButton()
      this.scene.tweens.add({
        targets: [circle, label],
        scale: 0.88,
        duration: 70,
        yoyo: true,
      })
    })
  }

  private refreshQualityText(): void {
    const q = QUALITY.level === 'high' ? 'ВЫС' : 'НИЗ'
    this.qualityText.setText(`Q — качество: ${q}`)
  }

  /** Вызывать каждый кадр (можно и в заморозке — UI живёт). */
  update(dtMs: number): void {
    const v = this.vitals
    const h = BALANCE.hunger
    const g = this.gfx
    g.clear()

    // Призрачный след HP: белая полоса «догоняет» красную (juice урона).
    const hpR = v.hpRatio
    this.ghostHp = Math.max(hpR, this.ghostHp - dtMs / 700)
    const hungerR = v.hungerRatio
    const starving = v.starving
    const lowHunger = hungerR < h.warnBelow / 100

    // Пульс голода/голода-нуля.
    if (lowHunger || starving) {
      this.hungerPulse += dtMs / (starving ? 260 : 520)
    } else {
      this.hungerPulse = 0
    }
    const pulse = (lowHunger || starving) ? 0.5 + 0.5 * Math.abs(Math.sin(this.hungerPulse * Math.PI)) : 1

    // Подложки.
    g.fillStyle(0x0b0b10, 0.72)
    g.fillRect(BAR_X - 6, BAR_Y - 6, BAR_W + 12, BAR_H + 22)

    // HP: призрак + алая полоса.
    g.fillStyle(0xe8e6e3, 0.5)
    g.fillRect(BAR_X, BAR_Y, BAR_W * this.ghostHp, BAR_H)
    g.fillStyle(0xe23a4e, 1)
    g.fillRect(BAR_X, BAR_Y, BAR_W * hpR, BAR_H)
    g.lineStyle(1, 0x2a2a3a, 1)
    g.strokeRect(BAR_X - 0.5, BAR_Y - 0.5, BAR_W + 1, BAR_H + 1)

    // Голод: янтарь мяса, при пустом — мигает кровавым (HP тает).
    const hungerY = BAR_Y + BAR_H + 5
    g.fillStyle(0x1a1a26, 1)
    g.fillRect(BAR_X, hungerY, BAR_W, BAR_H - 3)
    if (starving) {
      g.fillStyle(0xe23a4e, 0.35 + pulse * 0.5)
    } else {
      g.fillStyle(0xe8a34f, lowHunger ? 0.55 + pulse * 0.45 : 0.95)
    }
    g.fillRect(BAR_X, hungerY, BAR_W * hungerR, BAR_H - 3)
    g.lineStyle(1, 0x2a2a3a, 1)
    g.strokeRect(BAR_X - 0.5, hungerY - 0.5, BAR_W + 1, BAR_H - 2)

    // Рост: тонкая споровая полоса.
    const xpY = hungerY + BAR_H
    g.fillStyle(0xb36bff, 0.9)
    g.fillRect(BAR_X, xpY, BAR_W * v.xpRatio, 2.5)

    this.levelText.setText(`РОСТ ${v.level} · съедено ${v.eatenCount}`)

    // Слоты мутаций (шаг 8): 6 рамок (+гнездо от постоянного гена).
    // Занятые — кристалл в цвет редкости (проклятия — багровая рамка),
    // пустые — тусклый контур: видно, сколько места осталось.
    const owned = this.mutations.ownedList
    const slots = this.mutations.slots
    const slotY = xpY + 14
    g.lineStyle(1, 0x2a2a3a, 1)
    for (let i = 0; i < slots; i++) {
      const x = BAR_X + 6 + i * 18
      g.fillStyle(0x0b0b10, 0.6)
      g.fillRect(x - 7, slotY - 9, 14, 18)
      g.strokeRect(x - 7.5, slotY - 9.5, 15, 19)
    }
    // Кристаллы поверх рамок.
    while (this.mutationIcons.length < owned.length) {
      const icon = this.scene.add.image(0, 0, 'mutation-gem')
        .setScrollFactor(0)
        .setDepth(DEPTH_HUD)
        .setScale(0.9)
      this.mutationIcons.push(icon)
    }
    this.mutationIcons.forEach((icon, i) => {
      const show = i < owned.length
      icon.setVisible(show)
      if (show) {
        const def = owned[i]
        icon.setPosition(BAR_X + 6 + i * 18, slotY).setTint(rarityColor(def.rarity))
        icon.setScale(def.rarity === 'curse' ? 0.8 : 0.9)
      }
    })
  }

  /** Сколько пикселей занимает HUD слева (для мини-карты и прочего). */
  static get reservedHeight(): number {
    return 84
  }
}
