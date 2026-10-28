import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Observable, map } from 'rxjs';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

// Все тексты приходят уже переведёнными: окно не знает, ЧТО подтверждают, —
// поэтому одно и то же окно годится и для блокировки, и для разрыва мэтча, и для чего угодно ещё.
export interface ConfirmDialogData {
  title: string;
  // Одна строка о последствиях: что именно пропадёт после подтверждения.
  message: string;
  // Подпись главной кнопки — само действие («Заблокировать»), а не безликое «ОК».
  confirm: string;
  // Подпись отмены; по умолчанию «Отмена».
  cancel?: string;
  // Значок Material Symbols рядом с заголовком (например, 'block').
  icon?: string;
  // Разрушительное действие: красная кнопка и красная рамка (--mat-sys-error).
  destructive?: boolean;
}

// Окно подтверждения вместо браузерного confirm(): тот выглядит чужеродно, не переводится
// и блокирует всю страницу. Отвечает true («да») или undefined (отмена, Esc, клик мимо окна).
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, TranslatePipe],
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.scss',
  host: {
    '[class.destructive]': 'data.destructive',
  },
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}

// Помощник: открывает окно с нужными настройками и превращает ответ в простое true/false.
// Использование: confirmDialog(this.dialog, { ... }).subscribe((ok) => { if (ok) ... }).
//
// restoreFocus — куда вернуть фокус после закрытия. По умолчанию Material возвращает его
// на элемент, который был в фокусе до открытия окна. Но если окно открыто из пункта меню,
// этот пункт к закрытию окна уже уничтожен (меню закрылось), и фокус падает на <body>:
// клавиатурный пользователь оказывается в начале страницы. Тогда сюда передают кнопку,
// которая открывала меню.
export function confirmDialog(
  dialog: MatDialog,
  data: ConfirmDialogData,
  restoreFocus?: HTMLElement,
): Observable<boolean> {
  return dialog
    .open<ConfirmDialog, ConfirmDialogData, true>(ConfirmDialog, {
      data,
      // Фокус — на «Отмене» (у неё cdkFocusInitial): случайный Enter ничего не разрушит.
      autoFocus: 'first-tabbable',
      // Рамку и фон окно рисует само, а подложку Material этот класс делает прозрачной
      // (см. .di-framed-dialog в styles.scss — тот же приём, что у окна «Это мэтч!»).
      panelClass: 'di-framed-dialog',
      maxWidth: 400,
      width: 'calc(100vw - 32px)',
      restoreFocus: restoreFocus ?? true,
    })
    .afterClosed()
    .pipe(map((result) => result === true));
}
