import { Component, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/auth/auth';
import { I18n } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ModerationService } from '../../core/moderation/moderation';
import { confirmDialog } from '../confirm-dialog/confirm-dialog';
import { ReportDialog, ReportDialogData, ReportDialogResult } from '../report-dialog/report-dialog';

// Кнопка «⋮» с действиями над другим игроком: разорвать мэтч, пожаловаться, заблокировать.
// Одна на ленту, мэтчи и чат — поэтому лежит в shared, а не в какой-то странице.
@Component({
  selector: 'app-moderation-menu',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, TranslatePipe],
  templateUrl: './moderation-menu.html',
  styleUrl: './moderation-menu.scss',
})
export class ModerationMenu {
  private readonly moderation = inject(ModerationService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18n);

  readonly otherUid = input.required<string>();
  readonly name = input.required<string>();
  // Есть ли мэтч — только тогда в меню появляется «Разорвать мэтч».
  readonly matched = input(false);

  // Два события вокруг «убирающих» действий (разрыв мэтча, блок, жалоба с блоком):
  //
  // removing — человек нажал «Да» в окне подтверждения, запрос в Firestore ещё НЕ ушёл.
  // Нужен странице, чтобы заранее понять: сейчас мэтч исчезнет по нашей же воле.
  // Например, чат слушает свой мэтч и, увидев его удаление, показывает «чат завершён» —
  // а при собственном разрыве это сообщение лишнее, поэтому по removing чат его глушит.
  // Если запрос потом упадёт, removed не придёт — странице стоит быть к этому готовой.
  readonly removing = output<void>();

  // removed — запрос успешно выполнен, человек убран. Страница сама решает, что делать:
  // убрать карточку из списка или уйти из чата.
  readonly removed = output<void>();

  // removeFailed — пара к removing: запрос упал (ошибку меню уже показало снекбаром).
  // Страница, которая по removing что-то «заморозила», здесь должна это разморозить.
  readonly removeFailed = output<void>();

  protected readonly busy = signal(false);

  // Устройство без наведения (телефон, планшет): подсказку у «⋮» там не показываем.
  // Проверяем один раз при создании: тип устройства на лету почти не меняется.
  protected readonly noHover =
    typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;

  // Сама кнопка «⋮». Окна (подтверждение, жалоба) открываются из пункта меню, а пункт
  // исчезает вместе с меню ещё до закрытия окна. Material вернул бы фокус на исчезнувший пункт,
  // то есть никуда — фокус падал на <body>. Поэтому явно говорим окну: «верни фокус на «⋮»».
  // Material делает это через FocusMonitor с тем же «источником», что и закрытие: закрыли
  // клавишей Esc — у кнопки будет видимая рамка фокуса, кликом мыши — не будет.
  // Если человек подтвердил разрыв или блок, карточка потом исчезнет, и фокус дальше
  // переставит уже страница (removed) — на соседнюю карточку или заголовок.
  private readonly trigger = viewChild.required(MatMenuTrigger, { read: ElementRef });

  protected unmatch(): void {
    if (this.busy()) {
      return;
    }
    const name = { name: this.name() };
    this.confirm({
      title: this.i18n.translate('moderation.unmatchTitle', name),
      // Вторая фраза отвечает на главный страх: «он узнает?» — нет, уведомления не будет.
      message: [
        this.i18n.translate('moderation.unmatchText'),
        this.i18n.translate('moderation.quiet', name),
      ].join(' '),
      confirm: this.i18n.translate('moderation.unmatchAction', name),
      icon: 'heart_broken',
    }).subscribe((ok) => {
      if (ok) {
        void this.run(
          () => this.moderation.unmatch(this.me, this.otherUid()),
          'moderation.unmatched',
          true,
        );
      }
    });
  }

  protected block(): void {
    if (this.busy()) {
      return;
    }
    const name = { name: this.name() };
    this.confirm({
      title: this.i18n.translate('moderation.blockTitle', name),
      // Вторая фраза — та же, что у разрыва мэтча: уведомления о блокировке не будет.
      // Последствия зависят от того, где открыто меню: в ленте мэтча и чата ещё нет —
      // и упоминать их значит пугать тем, чего не случится.
      message: [
        this.i18n.translate(
          this.matched() ? 'moderation.blockTextMatched' : 'moderation.blockTextFeed',
        ),
        this.i18n.translate('moderation.quiet', name),
      ].join(' '),
      confirm: this.i18n.translate('moderation.blockAction', name),
      icon: 'block',
    }).subscribe((ok) => {
      if (ok) {
        void this.run(
          () => this.moderation.block(this.me, this.otherUid()),
          'moderation.blocked',
          true,
        );
      }
    });
  }

  protected report(): void {
    if (this.busy()) {
      return;
    }
    this.dialog
      .open<ReportDialog, ReportDialogData, ReportDialogResult>(ReportDialog, {
        data: { name: this.name(), matched: this.matched() },
        // Рамку и фон окно рисует само (как ConfirmDialog), подложку Material этот класс
        // делает прозрачной. Ширина «до 440px, но с отступом 16px от краёв» — для телефонов.
        panelClass: 'di-framed-dialog',
        maxWidth: 440,
        width: 'calc(100vw - 32px)',
        // Фокус — на заголовок, а не на первую причину: кольцо фокуса на радиокнопке
        // выглядело так, будто причина уже выбрана за человека.
        autoFocus: 'first-heading',
        restoreFocus: this.triggerElement,
      })
      .afterClosed()
      .subscribe((result) => {
        if (!result) {
          return; // нажали «Отмена» или кликнули мимо окна
        }
        void this.run(
          async () => {
            await this.moderation.report(this.me, this.otherUid(), result.reason, result.comment);
            if (result.block) {
              await this.moderation.block(this.me, this.otherUid());
            }
          },
          result.block ? 'moderation.reportedBlocked' : 'moderation.reported',
          result.block,
        );
      });
  }

  // Оба действия (разрыв и блок) необратимы, поэтому окно — «опасное»: красная кнопка,
  // фокус на «Отмене». Кнопка отмены берёт перевод из того же раздела moderation.
  private confirm(data: { title: string; message: string; confirm: string; icon: string }) {
    return confirmDialog(
      this.dialog,
      {
        ...data,
        cancel: this.i18n.translate('moderation.cancel'),
        destructive: true,
      },
      this.triggerElement,
    );
  }

  private get triggerElement(): HTMLElement {
    return this.trigger().nativeElement as HTMLElement;
  }

  // Общая часть всех действий: блокируем кнопку, выполняем, сообщаем результат.
  // Вызывается уже ПОСЛЕ подтверждения, поэтому removing сообщаем здесь — до первого await,
  // то есть строго раньше, чем запрос уйдёт в Firestore.
  private async run(action: () => Promise<void>, doneKey: string, removes: boolean): Promise<void> {
    this.busy.set(true);
    if (removes) {
      this.removing.emit();
    }
    try {
      await action();
      this.snackBar.open(this.i18n.translate(doneKey, { name: this.name() }), undefined, {
        duration: 4000,
      });
      if (removes) {
        this.removed.emit();
      }
    } catch (error) {
      console.error(error);
      this.snackBar.open(this.i18n.translate('moderation.error'), undefined, { duration: 4000 });
      if (removes) {
        this.removeFailed.emit();
      }
    } finally {
      this.busy.set(false);
    }
  }

  // Меню показывается только на страницах за authGuard, поэтому пользователь здесь всегда есть.
  private get me(): string {
    return this.auth.user()!.uid;
  }
}
