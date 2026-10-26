import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../core/auth/auth';
import { authErrorKey } from '../../core/auth/auth-errors';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

type Mode = 'login' | 'register';

// Валидатор поля «Повтори пароль»: сравнивает значение с соседним полем password.
function matchesPassword(control: AbstractControl): ValidationErrors | null {
  return control.value === control.parent?.get('password')?.value ? null : { mismatch: true };
}

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TranslatePipe,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly minPasswordLength = 6;
  protected readonly mode = signal<Mode>('login');
  protected readonly loading = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly hidePassword = signal(true);

  // Реактивная форма: описание полей и правил проверки живёт в TypeScript, шаблон только привязывается.
  // NonNullable — после reset() поля становятся '' и false, а не null.
  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(this.minPasswordLength)]],
    // Правила для этих двух полей включаются только в режиме регистрации — см. setMode().
    confirmPassword: [''],
    adult: [false],
  });

  constructor() {
    // Поменяли пароль — заново проверяем «Повтори пароль».
    // takeUntilDestroyed отписывается сам, когда компонент уничтожается.
    this.form.controls.password.valueChanges
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => this.form.controls.confirmPassword.updateValueAndValidity());
  }

  protected setMode(mode: Mode): void {
    this.mode.set(mode);
    this.errorKey.set(null);

    const { confirmPassword, adult } = this.form.controls;
    if (mode === 'register') {
      confirmPassword.setValidators([Validators.required, matchesPassword]);
      adult.setValidators(Validators.requiredTrue);
    } else {
      confirmPassword.clearValidators();
      adult.clearValidators();
    }
    confirmPassword.updateValueAndValidity();
    adult.updateValueAndValidity();
  }

  protected submit(): Promise<void> | void {
    if (this.form.invalid) {
      // Подсвечиваем все ошибки сразу, даже в полях, которые ещё не трогали.
      this.form.markAllAsTouched();
      return;
    }
    const { email, password } = this.form.getRawValue();
    return this.run(() =>
      this.mode() === 'login' ? this.auth.login(email, password) : this.auth.register(email, password),
    );
  }

  protected loginWithGoogle(): Promise<void> {
    return this.run(() => this.auth.loginWithGoogle());
  }

  // Общая обёртка: включаем «загрузку», ловим ошибку Firebase, после успеха уходим дальше.
  private async run(action: () => Promise<void>): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      await action();
      await this.router.navigateByUrl(this.returnUrl());
    } catch (error) {
      this.errorKey.set(authErrorKey(error));
    } finally {
      this.loading.set(false);
    }
  }

  // Куда вернуть после входа: guard положил адрес в ?returnUrl=. Пускаем только адреса нашего сайта.
  private returnUrl(): string {
    const url = this.route.snapshot.queryParamMap.get('returnUrl');
    return url?.startsWith('/') && !url.startsWith('//') ? url : '/feed';
  }
}
