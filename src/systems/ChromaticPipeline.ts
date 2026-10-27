import Phaser from 'phaser'

/**
 * ChromaticPipeline — шаг 9: хроматическая аберрация как пост-шейдер
 * камеры (в Phaser 3.90 встроенной нет — «дорогой» вариант гайда: свой
 * GLSL). RGB-каналы расходятся от центра кадра на uOffset и сходятся
 * обратно за CHROMA_FADE_MS — кадр «двоится» как после сильного удара.
 */
export class ChromaticPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  /** Сила расхождения каналов (доля UV, ~0.006 — заметный рывок). */
  public offset = 0

  constructor(game: Phaser.Game) {
    super({
      game,
      fragShader: `
precision mediump float;
uniform sampler2D uMainSampler;
uniform float uOffset;
varying vec2 outTexCoord;
void main () {
  vec2 dir = outTexCoord - 0.5;
  float r = texture2D(uMainSampler, outTexCoord + dir * uOffset).r;
  float g = texture2D(uMainSampler, outTexCoord).g;
  float b = texture2D(uMainSampler, outTexCoord - dir * uOffset).b;
  float a = texture2D(uMainSampler, outTexCoord).a;
  gl_FragColor = vec4(r, g, b, a);
}
`,
    })
  }

  override onPreRender(): void {
    this.set1f('uOffset', this.offset)
  }
}
