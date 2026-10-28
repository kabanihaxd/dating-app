import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { confirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { I18n } from '../i18n/i18n';

// Окно «Уйти без сохранения?» — то же фирменное окно подтверждения, что и у блокировки,
// только с другими текстами. «Остаться» — это кнопка отмены: на ней стоит начальный фокус,
// и Esc/клик мимо окна тоже означают «остаться», так что правки случайно не пропадут.
export function confirmLeave(dialog: MatDialog, i18n: I18n): Promise<boolean> {
  return firstValueFrom(
    confirmDialog(dialog, {
      title: i18n.translate('profile.leave.title'),
      message: i18n.translate('profile.leave.text'),
      confirm: i18n.translate('profile.leave.leave'),
      cancel: i18n.translate('profile.leave.stay'),
      icon: 'edit_note',
    }),
  );
}
