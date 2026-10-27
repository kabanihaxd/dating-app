import { Component, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../core/auth/auth';
import { I18n } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ModerationService } from '../../core/moderation/moderation';
import { ReportDialog, ReportDialogData, ReportDialogResult } from '../report-dialog/report-dialog';

// Кнопка «⋮» с действиями над другим игроком: разорвать мэтч, пожаловаться, заблокировать.
// Одна на ленту, мэтчи и чат — поэтому лежит в shared, а не в какой-то странице.
@Component({
  selector: 'app-moderation-menu',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, TranslatePipe],
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

  // Человек убран (мэтч разорван или заблокирован) — страница сама решает, что делать:
  // убрать карточку из списка или уйти из чата.
  readonly removed = output<void>();

  protected readonly busy = signal(false);

  protected unmatch(): void {
    if (confirm(this.i18n.translate('moderation.unmatchConfirm', { name: this.name() }))) {
      void this.run(
        () => this.moderation.unmatch(this.me, this.otherUid()),
        'moderation.unmatched',
        true,
      );
    }
  }

  protected block(): void {
    if (confirm(this.i18n.translate('moderation.blockConfirm', { name: this.name() }))) {
      void this.run(
        () => this.moderation.block(this.me, this.otherUid()),
        'moderation.blocked',
        true,
      );
    }
  }

  protected report(): void {
    this.dialog
      .open<ReportDialog, ReportDialogData, ReportDialogResult>(ReportDialog, {
        data: { name: this.name() },
        width: '440px',
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

  // Общая часть всех действий: блокируем кнопку, выполняем, сообщаем результат.
  private async run(action: () => Promise<void>, doneKey: string, removes: boolean): Promise<void> {
    this.busy.set(true);
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
    } finally {
      this.busy.set(false);
    }
  }

  // Меню показывается только на страницах за authGuard, поэтому пользователь здесь всегда есть.
  private get me(): string {
    return this.auth.user()!.uid;
  }
}
