import { Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { isNetworkErrorKey } from '../../core/firebase/firestore-errors';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { StateMessage } from '../state-message/state-message';

// Ошибка загрузки страницы: понятный текст + кнопка «Спробувати ще раз».
// Что именно повторять, решает страница — она подписывается на (retry).
@Component({
  selector: 'app-error-state',
  imports: [MatButtonModule, MatIconModule, TranslatePipe, StateMessage],
  template: `
    <!-- role="alert" — программа чтения с экрана сразу озвучит ошибку. -->
    <app-state-message tone="error" [icon]="icon()" role="alert">
      <h2>{{ 'errors.title' | t }}</h2>
      <p>{{ errorKey() | t }}</p>
      <button mat-flat-button type="button" (click)="retry.emit()">
        <mat-icon>refresh</mat-icon>
        {{ 'errors.retry' | t }}
      </button>
    </app-state-message>
  `,
})
export class ErrorState {
  readonly errorKey = input.required<string>();
  readonly retry = output<void>();

  protected readonly icon = computed(() =>
    isNetworkErrorKey(this.errorKey()) ? 'cloud_off' : 'error_outline',
  );
}
