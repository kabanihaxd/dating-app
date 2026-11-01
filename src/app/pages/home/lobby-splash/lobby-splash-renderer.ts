// Заставка главной «экран выбора игроков»: P1 (ты, голубой) готов, слот P2 (розовый) пуст,
// между ними геймпад. Сцена рисуется в скрытый canvas, а на видимый попадает уже как ASCII:
// эффект «prospect glitch» с 21st.dev (renderMode characters, charSet binary), подогнанный под сайт.
// Надписи (P1/P2, READY, PRESS START) рисуются поверх эффекта, иначе они превращаются в кашу из символов.

const PINK = '#ff2e88';
const CYAN = '#00e5ff';
const VOID = '#0b0b12';

// Сцена задана в логических координатах 1600×900 и вписывается в размер заставки.
const SW = 1600;
const SH = 900;
const SLOT_W = 330;
const SLOT_H = 460;
const SLOT_Y = 150;
const P1X = 560;
const P2X = 1040;

// Параметры эффекта из рецепта 21st.dev, которые реально участвуют в картинке.
const CELL = 9;
const CHARS = '01';
const CONTRAST = 1.15;
const EDGE_EMPHASIS = 0.4;
const TONE_CURVE = [
  { x: 0, y: 0 },
  { x: 0.4398625429553265, y: 0.5415214866434379 },
  { x: 1, y: 1 },
];
// В рецепте фон 100%, но тогда символы теряются на картинке — приглушаем до 35%.
const BG_OPACITY = 0.35;
const VIGNETTE = 0.72;
const SCAN_LINES = 0.28;

const rand = (i: number) => {
  const x = Math.sin(i * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function tone(v: number): number {
  for (let i = 1; i < TONE_CURVE.length; i++) {
    const a = TONE_CURVE[i - 1];
    const b = TONE_CURVE[i];
    if (v <= b.x) return a.y + (b.y - a.y) * ((v - a.x) / (b.x - a.x || 1));
  }
  return 1;
}

const clamp = (v: number, lo = 0, hi = 255) => (v < lo ? lo : v > hi ? hi : v);

function context(canvas: HTMLCanvasElement, readback = false): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: readback });
  if (!ctx) throw new Error('Canvas 2D is not supported');
  return ctx;
}

export class LobbySplashRenderer {
  private readonly octx: CanvasRenderingContext2D;
  // Скрытые холсты: сцена, слой символов и «1 пиксель = цвет клетки».
  private readonly scene = document.createElement('canvas');
  private readonly ctx = context(this.scene, true);
  private readonly glyphs = document.createElement('canvas');
  private readonly gctx = context(this.glyphs);
  private readonly colors = document.createElement('canvas');
  private readonly cctx = context(this.colors);
  private readonly atlas = this.buildAtlas();

  private readonly sparks = Array.from({ length: 60 }, (_, i) => ({
    x: rand(i) * SW,
    y: rand(i + 40) * SH,
    v: 10 + rand(i + 9) * 30,
    p: rand(i + 5) * 6,
  }));

  private w = 0;
  private h = 0;
  private k = 1;
  private ox = 0;
  private oy = 0;
  private raw = new Float32Array(0);
  private lum = new Float32Array(0);
  private cellImg: ImageData | null = null;

  // waitingText — подпись под P2 («ждёт»), приходит из переводов.
  constructor(
    private readonly out: HTMLCanvasElement,
    private readonly waitingText: () => string,
  ) {
    this.octx = context(out);
  }

  // Размер в CSS-пикселях, без devicePixelRatio: эффект считается по пикселям,
  // и на 4K-экране с ним было бы вчетверо медленнее, а ASCII всё равно крупный.
  resize(width: number, height: number): void {
    this.w = Math.max(1, Math.round(width));
    this.h = Math.max(1, Math.round(height));
    for (const c of [this.scene, this.out, this.glyphs]) {
      c.width = this.w;
      c.height = this.h;
    }
    if (this.w < 700) {
      // Телефон: оба слота вписываем по ширине, сверху и снизу остаётся тёмный фон.
      this.k = this.w / 820;
      this.ox = this.w / 2 - 800 * this.k;
      this.oy = this.h * 0.5 - 420 * this.k;
    } else {
      // Широкий экран: cover, и сцену чуть ниже — сверху стоят заголовок и подзаголовок страницы.
      this.k = Math.max(this.w / SW, this.h / SH);
      this.ox = (this.w - SW * this.k) / 2;
      this.oy = (this.h - SH * this.k) / 2 + 48;
    }
  }

  // t — время в мс; при «уменьшить движение» сюда всегда приходит 0, и кадр статичный.
  frame(t: number): void {
    // Первый кадр может прийти раньше, чем ResizeObserver сообщит размер, — тогда рисовать не на чем.
    if (!this.w) return;
    const s = t / 1000;
    this.drawScene(s);
    this.applyEffect(t);
    this.drawLabels(s);
  }

  // ---------- Сцена ----------

  private drawScene(s: number): void {
    const { ctx, w, h } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bg = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.7);
    bg.addColorStop(0, '#1d1036');
    bg.addColorStop(1, VOID);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(this.k, 0, 0, this.k, this.ox, this.oy);

    // Неоновая сетка пола, которая едет на зрителя.
    const horizon = 600;
    ctx.strokeStyle = 'rgba(168,85,247,0.55)';
    ctx.lineWidth = 2;
    for (let i = -12; i <= 12; i++) {
      ctx.beginPath();
      ctx.moveTo(800 + i * 30, horizon);
      ctx.lineTo(800 + i * 260, 1100);
      ctx.stroke();
    }
    const phase = (s * 0.6) % 1;
    for (let i = 0; i < 9; i++) {
      const z = (i + phase) / 9;
      const y = horizon + (1100 - horizon) * z * z;
      ctx.globalAlpha = z;
      ctx.beginPath();
      ctx.moveTo(-400, y);
      ctx.lineTo(2000, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // P1 — ты, готов. Силуэт залит светом сверху: тогда ASCII заполняет всю фигуру, а не только контур.
    this.spotlight(P1X, 'rgba(0,229,255,A)', 0.22);
    this.slotFrame(P1X, CYAN, 1);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(P1X - SLOT_W / 2, SLOT_Y, SLOT_W, SLOT_H, 16);
    ctx.clip();
    const lit = ctx.createLinearGradient(0, 250, 0, SLOT_Y + SLOT_H);
    lit.addColorStop(0, 'rgba(0,229,255,0.85)');
    lit.addColorStop(0.45, 'rgba(0,229,255,0.45)');
    lit.addColorStop(1, 'rgba(168,85,247,0.25)');
    ctx.fillStyle = lit;
    this.bodyPath(P1X);
    ctx.fill();
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 3;
    ctx.shadowColor = CYAN;
    ctx.shadowBlur = 16;
    this.bodyPath(P1X);
    ctx.stroke();
    // Наушники.
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(P1X, 318, 62, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    ctx.fillStyle = CYAN;
    ctx.beginPath();
    ctx.roundRect(P1X - 74, 300, 20, 44, 8);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(P1X + 54, 300, 20, 44, 8);
    ctx.fill();
    ctx.restore();

    // P2 — пустой слот, мягко пульсирует розовым.
    const pulse = 0.5 + 0.5 * Math.sin(s * 2.4);
    this.spotlight(P2X, 'rgba(255,46,136,A)', 0.12 + 0.12 * pulse);
    this.slotFrame(P2X, PINK, 0.45 + 0.55 * pulse);
    ctx.save();
    ctx.setLineDash([14, 12]);
    ctx.lineDashOffset = -s * 30;
    ctx.strokeStyle = `rgba(255,46,136,${0.3 + 0.25 * pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(P2X - SLOT_W / 2, SLOT_Y, SLOT_W, SLOT_H, 16);
    ctx.clip();
    this.bodyPath(P2X);
    ctx.stroke();
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.font = '900 170px system-ui, sans-serif';
    ctx.fillStyle = PINK;
    ctx.globalAlpha = 0.55 + 0.45 * pulse;
    ctx.fillText('?', P2X, 400);
    ctx.globalAlpha = 1;
    const haze = ctx.createRadialGradient(P2X, 380, 0, P2X, 380, 200);
    haze.addColorStop(0, `rgba(255,46,136,${0.25 + 0.15 * pulse})`);
    haze.addColorStop(1, 'rgba(255,46,136,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(P2X - SLOT_W / 2, SLOT_Y, SLOT_W, SLOT_H);

    // Искры, летящие вверх: голубые на стороне P1, розовые на стороне P2.
    for (const sp of this.sparks) {
      const y = (sp.y - s * sp.v) % SH;
      ctx.fillStyle = sp.x < 800 ? CYAN : PINK;
      ctx.globalAlpha = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(s * 2 + sp.p));
      ctx.fillRect(sp.x, y < 0 ? y + SH : y, 3, 3);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // Силуэт игрока анфас: голова и плечи в худи.
  private bodyPath(cx: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.ellipse(cx, 320, 52, 62, 0, 0, Math.PI * 2);
    ctx.moveTo(cx - 140, SLOT_Y + SLOT_H);
    ctx.quadraticCurveTo(cx - 138, 430, cx - 60, 410);
    ctx.quadraticCurveTo(cx, 395, cx + 60, 410);
    ctx.quadraticCurveTo(cx + 138, 430, cx + 140, SLOT_Y + SLOT_H);
    ctx.closePath();
  }

  private slotFrame(cx: number, color: string, alpha: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = '#0e0e1a';
    ctx.beginPath();
    ctx.roundRect(cx - SLOT_W / 2, SLOT_Y, SLOT_W, SLOT_H, 16);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 4;
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.stroke();
    ctx.restore();
  }

  // color — rgba-строка с буквой A на месте прозрачности.
  private spotlight(cx: number, color: string, alpha: number): void {
    const { ctx } = this;
    const g = ctx.createLinearGradient(0, 0, 0, SLOT_Y + SLOT_H);
    g.addColorStop(0, color.replace('A', String(alpha)));
    g.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - 40, -20);
    ctx.lineTo(cx + 40, -20);
    ctx.lineTo(cx + 230, SLOT_Y + SLOT_H);
    ctx.lineTo(cx - 230, SLOT_Y + SLOT_H);
    ctx.closePath();
    ctx.fill();
  }

  // ---------- Эффект ASCII ----------

  // Атлас символов: каждый символ один раз белым — дальше только drawImage, это в разы быстрее fillText.
  private buildAtlas(): HTMLCanvasElement {
    const size = CELL * 2;
    const atlas = document.createElement('canvas');
    atlas.width = size * CHARS.length;
    atlas.height = size;
    const a = context(atlas);
    a.fillStyle = '#fff';
    a.textAlign = 'center';
    a.textBaseline = 'middle';
    a.font = `700 ${size * 0.95}px ui-monospace, Consolas, monospace`;
    [...CHARS].forEach((ch, i) => a.fillText(ch, size * i + size / 2, size / 2 + 1));
    return atlas;
  }

  private applyEffect(t: number): void {
    const { w, h, gctx, octx, cctx } = this;
    const cols = Math.ceil(w / CELL);
    const rows = Math.ceil(h / CELL);
    const n = cols * rows;
    if (this.raw.length !== n || !this.cellImg) {
      this.raw = new Float32Array(n);
      this.lum = new Float32Array(n);
      this.colors.width = cols;
      this.colors.height = rows;
      this.cellImg = cctx.createImageData(cols, rows);
    }
    const { raw, lum } = this;
    const cd = this.cellImg.data;

    // Средний цвет и яркость клеток (каждый второй пиксель — быстрее, а среднее почти то же).
    const data = this.ctx.getImageData(0, 0, w, h).data;
    for (let cy = 0; cy < rows; cy++) {
      const y1 = Math.min(h, (cy + 1) * CELL);
      for (let cx = 0; cx < cols; cx++) {
        const x1 = Math.min(w, (cx + 1) * CELL);
        let r = 0;
        let g = 0;
        let b = 0;
        let cnt = 0;
        for (let y = cy * CELL; y < y1; y += 2) {
          for (let x = cx * CELL; x < x1; x += 2) {
            const i = (y * w + x) * 4;
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            cnt++;
          }
        }
        // Контраст из рецепта, затем тоновая кривая.
        const ar = clamp((r / cnt - 128) * CONTRAST + 128);
        const ag = clamp((g / cnt - 128) * CONTRAST + 128);
        const ab = clamp((b / cnt - 128) * CONTRAST + 128);
        const kk = cy * cols + cx;
        raw[kk] = tone((0.299 * ar + 0.587 * ag + 0.114 * ab) / 255);
        // Цвет символа: оттенок клетки, поднятый до неоновой яркости.
        const boost = (90 + 165 * Math.min(1, raw[kk] * 1.6)) / Math.max(ar, ag, ab, 1);
        cd[kk * 4] = ar * boost;
        cd[kk * 4 + 1] = ag * boost;
        cd[kk * 4 + 2] = ab * boost;
        cd[kk * 4 + 3] = 255;
      }
    }
    // Подсветка контуров: разница яркости с соседями добавляется к клетке.
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const gx =
          raw[cy * cols + Math.min(cols - 1, cx + 1)] - raw[cy * cols + Math.max(0, cx - 1)];
        const gy =
          raw[Math.min(rows - 1, cy + 1) * cols + cx] - raw[Math.max(0, cy - 1) * cols + cx];
        lum[cy * cols + cx] = clamp(
          raw[cy * cols + cx] + Math.hypot(gx, gy) * EDGE_EMPHASIS * 2,
          0,
          1,
        );
      }
    }
    cctx.putImageData(this.cellImg, 0, 0);

    // Символы: белые на прозрачном слое, размер и прозрачность — от яркости.
    // Без мерцания: каждая клетка раз в ~2 с меняет 0↔1, и каждая в свой момент, а не все разом.
    const tick = t / 2000;
    const as = this.atlas.height;
    gctx.globalCompositeOperation = 'source-over';
    gctx.clearRect(0, 0, w, h);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const kk = cy * cols + cx;
        const l = lum[kk];
        if (l < 0.07) continue;
        const ch = Math.floor(hash(kk, Math.floor(tick + hash(kk, 3)) + 9) * CHARS.length);
        const size = CELL * (0.65 + 0.6 * l);
        gctx.globalAlpha = Math.min(1, 0.25 + l);
        const x = cx * CELL + (CELL - size) / 2;
        const y = cy * CELL + (CELL - size) / 2;
        gctx.drawImage(this.atlas, ch * as, 0, as, as, x, y, size, size);
      }
    }
    gctx.globalAlpha = 1;
    // Красим символы цветами клеток: картинка «1 пиксель = клетка», растянутая через source-in.
    gctx.globalCompositeOperation = 'source-in';
    gctx.imageSmoothingEnabled = false;
    gctx.drawImage(this.colors, 0, 0, cols * CELL, rows * CELL);

    // Фон — сама сцена, приглушённая; поверх символы с лёгким неоновым ореолом.
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.globalCompositeOperation = 'source-over';
    octx.shadowBlur = 0;
    octx.fillStyle = VOID;
    octx.fillRect(0, 0, w, h);
    octx.globalAlpha = BG_OPACITY;
    octx.drawImage(this.scene, 0, 0);
    octx.globalAlpha = 1;
    octx.globalCompositeOperation = 'lighter';
    octx.filter = 'blur(4px)';
    octx.globalAlpha = 0.6;
    octx.drawImage(this.glyphs, 0, 0);
    octx.filter = 'none';
    octx.globalAlpha = 1;
    octx.drawImage(this.glyphs, 0, 0);
    octx.globalCompositeOperation = 'source-over';

    // Скан-линии и виньетка.
    octx.fillStyle = `rgba(0,0,0,${SCAN_LINES * 0.6})`;
    for (let y = 0; y < h; y += 3) octx.fillRect(0, y, w, 1);
    const vg = octx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.25,
      w / 2,
      h / 2,
      Math.hypot(w, h) / 2,
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(0,0,0,${VIGNETTE})`);
    octx.fillStyle = vg;
    octx.fillRect(0, 0, w, h);
  }

  // ---------- Чёткие надписи поверх эффекта ----------

  private drawLabels(s: number): void {
    const c = this.octx;
    c.setTransform(this.k, 0, 0, this.k, this.ox, this.oy);
    c.textAlign = 'center';
    this.pill(P1X - 70, SLOT_Y + SLOT_H - 40, 'Elden Ring');
    this.pill(P1X + 80, SLOT_Y + SLOT_H - 40, 'CS2');

    c.shadowBlur = 14;
    c.font = '900 64px system-ui, sans-serif';
    c.shadowColor = CYAN;
    c.fillStyle = CYAN;
    c.fillText('P1', P1X, SLOT_Y + SLOT_H + 76);
    c.shadowColor = PINK;
    c.fillStyle = PINK;
    c.fillText('P2', P2X, SLOT_Y + SLOT_H + 76);
    c.shadowBlur = 0;
    c.font = '700 22px system-ui, sans-serif';
    c.fillStyle = '#e6e6ef';
    c.fillText('READY ✓', P1X, SLOT_Y + SLOT_H + 108);
    c.fillText(
      this.waitingText() + '.'.repeat(1 + (Math.floor(s * 2) % 3)),
      P2X,
      SLOT_Y + SLOT_H + 108,
    );
    c.font = '800 28px system-ui, sans-serif';
    c.fillStyle = '#ffffff';
    c.shadowColor = PINK;
    c.shadowBlur = 12;
    c.fillText('▶ PRESS START', P2X, SLOT_Y + SLOT_H - 40);
    c.shadowBlur = 0;

    // Кооп, а не драка: линия связи от P1 к P2, по ней бегут огоньки, посередине геймпад.
    const ly = 380;
    const lx0 = P1X + SLOT_W / 2 + 6;
    const lx1 = P2X - SLOT_W / 2 - 6;
    const line = c.createLinearGradient(lx0, 0, lx1, 0);
    line.addColorStop(0, CYAN);
    line.addColorStop(1, PINK);
    c.strokeStyle = line;
    c.lineWidth = 3;
    c.globalAlpha = 0.5;
    c.setLineDash([10, 10]);
    c.lineDashOffset = -s * 40;
    c.beginPath();
    c.moveTo(lx0, ly);
    c.lineTo(800 - 44, ly);
    c.moveTo(800 + 44, ly);
    c.lineTo(lx1, ly);
    c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 1;
    for (let i = 0; i < 3; i++) {
      const p = (s * 0.45 + i / 3) % 1;
      const x = lx0 + (lx1 - lx0) * p;
      if (Math.abs(x - 800) < 48) continue;
      c.fillStyle = p < 0.5 ? CYAN : PINK;
      c.shadowColor = c.fillStyle;
      c.shadowBlur = 14;
      c.beginPath();
      c.arc(x, ly, 6, 0, Math.PI * 2);
      c.fill();
    }
    // Огоньки включили свечение — выключаем, иначе оно ляжет на весь следующий кадр.
    c.shadowBlur = 0;
    this.gamepad(800, ly, s);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  private pill(x: number, y: number, text: string): void {
    const c = this.octx;
    c.font = '600 17px system-ui, sans-serif';
    const w = c.measureText(text).width + 24;
    c.fillStyle = 'rgba(11,11,18,0.8)';
    c.strokeStyle = CYAN;
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(x - w / 2, y - 15, w, 30, 15);
    c.fill();
    c.stroke();
    c.fillStyle = CYAN;
    c.fillText(text, x, y + 6);
  }

  // Геймпад: контур от голубого (P1) к розовому (P2), пульсирует — два удара и пауза.
  private gamepad(x: number, y: number, s: number): void {
    const c = this.octx;
    const beat = s % 1.4;
    const scale =
      1 +
      0.1 *
        (Math.exp(-((beat - 0.1) ** 2) / 0.004) + 0.7 * Math.exp(-((beat - 0.35) ** 2) / 0.004));
    c.save();
    c.translate(x, y);
    c.scale(scale * 0.68, scale * 0.68);
    const pad = c.createLinearGradient(-46, 0, 46, 0);
    pad.addColorStop(0, CYAN);
    pad.addColorStop(1, PINK);
    c.beginPath();
    c.moveTo(-26, -20);
    c.lineTo(26, -20);
    c.bezierCurveTo(44, -20, 50, -4, 52, 14);
    c.bezierCurveTo(54, 30, 40, 36, 32, 24);
    c.lineTo(22, 12);
    c.lineTo(-22, 12);
    c.lineTo(-32, 24);
    c.bezierCurveTo(-40, 36, -54, 30, -52, 14);
    c.bezierCurveTo(-50, -4, -44, -20, -26, -20);
    c.closePath();
    c.fillStyle = 'rgba(11,11,18,0.85)';
    c.fill();
    c.strokeStyle = pad;
    c.lineWidth = 4;
    c.shadowColor = PINK;
    c.shadowBlur = 16;
    c.stroke();
    c.shadowBlur = 0;
    // Крестовина голубая, кнопки розовые.
    c.fillStyle = CYAN;
    c.fillRect(-35, -4, 18, 6);
    c.fillRect(-29, -10, 6, 18);
    c.fillStyle = PINK;
    c.shadowColor = PINK;
    c.shadowBlur = 8;
    for (const [bx, by] of [
      [24, -6],
      [34, 2],
    ]) {
      c.beginPath();
      c.arc(bx, by, 5, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }
}
