import { DOCUMENT, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { CanDeactivateFn } from '@angular/router';
import { I18n } from '../i18n/i18n';
import { confirmLeave } from './leave-dialog';

// Страница, которую нельзя молча покинуть с несохранёнными правками, реализует этот интерфейс.
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

// canDeactivate — guard на УХОД со страницы (canActivate — на вход).
// Роутер вызывает его с текущим компонентом страницы: если правок нет — отпускаем сразу,
// иначе спрашиваем. Promise<boolean> роутер дождётся сам: false отменяет переход, страница остаётся.
// Закрытие вкладки или перезагрузку роутер не видит — их ловит beforeunload в самом компоненте.
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component.hasUnsavedChanges()) {
    return true;
  }
  // Что было в фокусе в момент попытки уйти — туда и вернём фокус после «Остаться»
  // (см. confirmLeave). <body> не в счёт: возвращать туда — то же, что никуда.
  const document = inject(DOCUMENT);
  const active = document.activeElement;
  const restoreFocus =
    active instanceof HTMLElement && active !== document.body ? active : undefined;
  return confirmLeave(inject(MatDialog), inject(I18n), restoreFocus);
};
