import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AuthService } from '../../core/auth/auth';
import { firestoreErrorKey } from '../../core/firebase/firestore-errors';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  SUPPORT_MESSAGE_MAX,
  SUPPORT_MESSAGE_MIN,
  SUPPORT_TOPICS,
  SupportService,
  SupportTopic,
} from '../../core/support/support';
import { StateMessage } from '../../shared/state-message/state-message';

@Component({
  selector: 'app-support',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    TranslatePipe,
    StateMessage,
  ],
  templateUrl: './support.html',
  styleUrl: './support.scss',
})
export class Support {
  private readonly support = inject(SupportService);

  protected readonly topics = SUPPORT_TOPICS;
  protected readonly maxMessage = SUPPORT_MESSAGE_MAX;
  protected readonly minMessage = SUPPORT_MESSAGE_MIN;

  // Вошедшему подставляем email аккаунта — ответ придёт туда, но поменять его можно.
  protected readonly form = inject(NonNullableFormBuilder).group({
    topic: ['' as SupportTopic | '', Validators.required],
    email: [inject(AuthService).user()?.email ?? '', [Validators.required, Validators.email]],
    message: [
      '',
      [
        Validators.required,
        Validators.minLength(SUPPORT_MESSAGE_MIN),
        Validators.maxLength(SUPPORT_MESSAGE_MAX),
      ],
    ],
  });

  protected readonly sending = signal(false);
  protected readonly sent = signal(false);
  protected readonly errorKey = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { topic, email, message } = this.form.getRawValue();
    this.sending.set(true);
    this.errorKey.set(null);
    try {
      await this.support.send(topic as SupportTopic, email.trim(), message.trim());
      this.sent.set(true);
    } catch (error) {
      this.errorKey.set(firestoreErrorKey(error));
    } finally {
      this.sending.set(false);
    }
  }
}
