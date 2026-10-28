import { Component, DestroyRef, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

// Полоска «Нет интернета» под шапкой. Браузер сам сообщает о потере и возврате сети
// событиями offline/online на window — мы просто храним это в signal.
@Component({
  selector: 'app-offline-banner',
  imports: [MatIconModule, TranslatePipe],
  template: `
    @if (offline()) {
      <!-- animate.enter / animate.leave — классы, которые Angular вешает на элемент
           при появлении и перед удалением. При удалении он ЖДЁТ конца CSS-анимации
           и только потом убирает элемент — так полоска плавно уезжает, а не исчезает рывком. -->
      <div class="banner" role="status" animate.enter="slide-down" animate.leave="slide-up">
        <mat-icon>wifi_off</mat-icon>
        {{ 'errors.offline' | t }}
      </div>
    }
  `,
  styleUrl: './offline-banner.scss',
})
export class OfflineBanner {
  protected readonly offline = signal(!navigator.onLine);

  constructor() {
    const update = () => this.offline.set(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    // Компонент живёт всё время работы сайта, но отписываться — хорошая привычка.
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    });
  }
}
