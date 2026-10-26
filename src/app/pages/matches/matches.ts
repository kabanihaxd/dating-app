import { Component } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

// Заготовка: мэтчи сделаем на этапе 6, чат — на этапе 7.
@Component({
  selector: 'app-matches',
  imports: [TranslatePipe],
  template: `<h2>{{ 'matches.title' | t }}</h2><p>{{ 'matches.placeholder' | t }}</p>`,
})
export class Matches {}
