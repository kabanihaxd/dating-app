import { Component } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

// Заготовка: ленту анкет сделаем на этапе 5.
@Component({
  selector: 'app-feed',
  imports: [TranslatePipe],
  template: `<h2>{{ 'feed.title' | t }}</h2><p>{{ 'feed.placeholder' | t }}</p>`,
})
export class Feed {}
