import {
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { I18n } from '../../../core/i18n/i18n';
import { LobbySplashRenderer } from './lobby-splash-renderer';

// Анимированная заставка первого экрана главной: «экран выбора игроков» в ASCII.
// Чисто декоративная (aria-hidden): смысл — заголовок и кнопка страницы поверх неё.
@Component({
  selector: 'app-lobby-splash',
  template: '<canvas #canvas></canvas>',
  styles: `
    :host {
      display: block;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
  host: { 'aria-hidden': 'true' },
})
export class LobbySplash {
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly i18n = inject(I18n);
  private readonly destroyRef = inject(DestroyRef);

  private waiting = '';
  private renderer?: LobbySplashRenderer;
  private frameId = 0;
  private visible = true;
  // «Уменьшить движение» в системе — рисуем один статичный кадр вместо анимации.
  private readonly still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    // Подпись под P2 переводится; при смене языка статичный кадр перерисовываем.
    effect(() => {
      this.waiting = this.i18n.translate('home.splash.waiting');
      if (this.still) this.drawStill();
    });

    afterNextRender(() => {
      this.renderer = new LobbySplashRenderer(this.canvas().nativeElement, () => this.waiting);
      const host = this.host.nativeElement;

      // Анимация крутится вне зоны Angular: иначе каждый кадр (60 раз в секунду)
      // запускал бы проверку изменений всего приложения.
      this.zone.runOutsideAngular(() => {
        const resize = new ResizeObserver(([entry]) => {
          this.renderer?.resize(entry.contentRect.width, entry.contentRect.height);
          if (this.still) this.drawStill();
        });
        resize.observe(host);

        // Заставка ушла за экран или вкладка свёрнута — не тратим батарею.
        const seen = new IntersectionObserver(([entry]) => {
          this.visible = entry.isIntersecting;
          this.schedule();
        });
        seen.observe(host);
        const onVisibility = () => this.schedule();
        document.addEventListener('visibilitychange', onVisibility);

        this.schedule();

        this.destroyRef.onDestroy(() => {
          cancelAnimationFrame(this.frameId);
          resize.disconnect();
          seen.disconnect();
          document.removeEventListener('visibilitychange', onVisibility);
        });
      });
    });
  }

  private schedule(): void {
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    if (this.still || !this.visible || document.hidden) return;
    const loop = (t: number) => {
      this.renderer?.frame(t);
      this.frameId = requestAnimationFrame(loop);
    };
    this.frameId = requestAnimationFrame(loop);
  }

  private drawStill(): void {
    this.renderer?.frame(0);
  }
}
