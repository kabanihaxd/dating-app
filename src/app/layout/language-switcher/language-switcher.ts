import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { I18n, LANGUAGES } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-language-switcher',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, TranslatePipe],
  template: `
    <button mat-button [matMenuTriggerFor]="menu" [attr.aria-label]="'lang.choose' | t">
      <mat-icon>language</mat-icon>
      {{ i18n.language().short }}
    </button>

    <mat-menu #menu="matMenu">
      @for (lang of languages; track lang.code) {
        <button
          mat-menu-item
          [class.active]="lang.code === i18n.lang()"
          (click)="i18n.use(lang.code)"
        >
          {{ lang.label }}
        </button>
      }
    </mat-menu>
  `,
  styles: `
    .active {
      color: var(--di-neon-cyan);
    }
  `,
})
export class LanguageSwitcher {
  protected readonly i18n = inject(I18n);
  protected readonly languages = LANGUAGES;
}
