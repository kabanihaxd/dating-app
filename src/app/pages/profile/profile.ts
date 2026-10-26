import { Component } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

// Заготовка: профиль сделаем на этапе 4.
@Component({
  selector: 'app-profile',
  imports: [TranslatePipe],
  template: `<h2>{{ 'profile.title' | t }}</h2><p>{{ 'profile.placeholder' | t }}</p>`,
})
export class Profile {}
