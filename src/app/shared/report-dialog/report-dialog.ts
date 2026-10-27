import { Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { REPORT_REASONS, ReportReason } from '../../core/moderation/moderation';

export interface ReportDialogData {
  name: string;
}

export interface ReportDialogResult {
  reason: ReportReason;
  comment: string;
  block: boolean;
}

export const MAX_REPORT_COMMENT = 500;

// Окно жалобы. Само ничего не сохраняет: закрываясь, отдаёт ответ тому, кто его открыл
// (dialogRef.close(result) → afterClosed() у открывшего). «Отмена» закрывает без ответа.
@Component({
  selector: 'app-report-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    TranslatePipe,
  ],
  templateUrl: './report-dialog.html',
  styleUrl: './report-dialog.scss',
})
export class ReportDialog {
  // inject(MAT_DIALOG_DATA) — данные, переданные в dialog.open(..., { data }).
  protected readonly data = inject<ReportDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ReportDialog, ReportDialogResult>>(MatDialogRef);

  protected readonly reasons = REPORT_REASONS;
  protected readonly maxComment = MAX_REPORT_COMMENT;

  protected readonly form = inject(NonNullableFormBuilder).group({
    reason: ['' as ReportReason | '', Validators.required],
    comment: ['', Validators.maxLength(MAX_REPORT_COMMENT)],
    // На того, на кого жалуются, обычно не хотят больше натыкаться — поэтому по умолчанию «да».
    block: [true],
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { reason, comment, block } = this.form.getRawValue();
    this.dialogRef.close({ reason: reason as ReportReason, comment: comment.trim(), block });
  }
}
