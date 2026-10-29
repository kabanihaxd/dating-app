import { Component, DestroyRef, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  MAT_SNACK_BAR_DATA,
  MatSnackBarAction,
  MatSnackBarActions,
  MatSnackBarLabel,
  MatSnackBarRef,
} from '@angular/material/snack-bar';

export interface NotificationToastData {
  // Значок Material Symbols: favorite — лайк, sports_esports — мэтч, chat_bubble — сообщение.
  icon: string;
  // Уже переведённая строка «кто + что»: «Alex: привет!». Всегда в одну строку (см. scss).
  text: string;
  // Подпись кнопки («Смотреть»).
  action: string;
  // Сколько висеть, мс. Таймер свой, а не duration снекбара — см. комментарий в классе.
  duration: number;
}

// Всплывашка уведомления (лайк, мэтч, сообщение) — свой компонент вместо простого
// snackBar.open(text, action). Зачем:
// 1) значок вместо эмодзи 💬/🎉 в тексте: эмодзи на каждой платформе рисуется по-своему
//    и не красится в цвет бренда, а mat-icon — один набор в одном стиле;
// 2) текст строго в одну строку с многоточием — длинное сообщение не раздувает плашку;
// 3) таймер, который ждёт: пока мышь над плашкой или фокус на кнопке «Смотреть», она не
//    исчезает (WCAG 2.2.1 — человеку должно хватить времени дочитать и нажать).
//    У MatSnackBar duration так не умеет, поэтому открываем без duration и закрываем сами.
// matSnackBarLabel / matSnackBarActions / matSnackBarAction — директивы Material: дают нашей
// разметке те же отступы и цвета (токены из styles.scss), что у стандартного снекбара.
@Component({
  selector: 'app-notification-toast',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSnackBarLabel,
    MatSnackBarActions,
    MatSnackBarAction,
  ],
  template: `
    <mat-icon class="icon" aria-hidden="true">{{ data.icon }}</mat-icon>
    <span matSnackBarLabel class="text">{{ data.text }}</span>
    <span matSnackBarActions>
      <button mat-button matSnackBarAction type="button" (click)="ref.dismissWithAction()">
        {{ data.action }}
      </button>
    </span>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      min-width: 0;
    }

    // Розовый значок: по правилу «один цвет — один смысл» розовый — это «тебя хотят / тебе пишут».
    .icon {
      flex-shrink: 0;
      margin-left: 16px;
      color: var(--di-neon-pink);
    }

    // min-width: 0 — иначе flex-элемент не сжимается уже своего текста и многоточие не появится.
    .text {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
  `,
  host: {
    '(mouseenter)': 'hold("hover", true)',
    '(mouseleave)': 'hold("hover", false)',
    '(focusin)': 'hold("focus", true)',
    '(focusout)': 'hold("focus", false)',
  },
})
export class NotificationToast {
  protected readonly data = inject<NotificationToastData>(MAT_SNACK_BAR_DATA);
  protected readonly ref = inject<MatSnackBarRef<NotificationToast>>(MatSnackBarRef);

  private timer: ReturnType<typeof setTimeout> | undefined;
  // Причины «подождать» помним по отдельности: мышь ушла, а фокус ещё на кнопке — ждём дальше.
  private readonly holds = new Set<'hover' | 'focus'>();

  constructor() {
    this.start(this.data.duration);
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected hold(reason: 'hover' | 'focus', on: boolean): void {
    if (on) {
      this.holds.add(reason);
      clearTimeout(this.timer);
    } else {
      this.holds.delete(reason);
      if (!this.holds.size) {
        // После паузы даём ещё 3 секунды — дочитать, но не висеть вечно.
        this.start(3000);
      }
    }
  }

  private start(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.ref.dismiss(), ms);
  }
}
