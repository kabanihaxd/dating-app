import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

// Подвал на всех страницах, кроме чата (тот во всю высоту экрана — см. app.scss).
@Component({
  selector: 'app-footer',
  imports: [RouterLink, TranslatePipe],
  template: `
    <footer>
      <span>© {{ year }} DeadIsland</span>
      <nav [attr.aria-label]="'footer.label' | t">
        <a routerLink="/rules">{{ 'footer.rules' | t }}</a>
        <a routerLink="/privacy">{{ 'footer.privacy' | t }}</a>
        <a routerLink="/safety">{{ 'footer.safety' | t }}</a>
        <a routerLink="/support">{{ 'footer.support' | t }}</a>
      </nav>
    </footer>
  `,
  styles: `
    footer {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 8px 24px;
      padding: 24px 16px;
      border-top: 1px solid rgba(168, 85, 247, 0.25);
      color: var(--di-text-muted);
      font-size: 13px;
    }
    nav {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px 24px;
    }
    a {
      color: var(--di-text-muted);
      text-decoration: none;
      /* 24px в высоту — чтобы по ссылке было удобно попасть пальцем. */
      padding: 4px 0;
    }
    a:hover {
      color: var(--di-neon-cyan);
    }
  `,
})
export class Footer {
  protected readonly year = new Date().getFullYear();
}
