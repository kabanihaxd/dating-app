import { Component } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

// Заготовка: вход и регистрацию сделаем на этапе 3 (Firebase).
@Component({
  selector: 'app-login',
  imports: [TranslatePipe],
  template: `<h2>{{ 'login.title' | t }}</h2><p>{{ 'login.placeholder' | t }}</p>`,
})
export class Login {}
