import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

// Какие разделы есть на каждой странице. Тексты — в переводах: info.<страница>.<раздел>.title / text.
const SECTIONS = {
  rules: ['age', 'real', 'respect', 'spam', 'enforce'],
  privacy: ['what', 'who', 'where', 'local', 'delete'],
  safety: ['contacts', 'money', 'meet', 'trust', 'report'],
} as const;

export type InfoPageName = keyof typeof SECTIONS;

// Текстовые страницы из подвала: «Правила», «Конфиденциальность», «Безопасность встреч».
// Одна страница на три адреса: какую показать, роутер передаёт через data: { page } в input.
@Component({
  selector: 'app-info',
  imports: [RouterLink, TranslatePipe],
  template: `
    <article class="info">
      <h1>{{ 'info.' + page() + '.title' | t }}</h1>
      <p class="lead">{{ 'info.' + page() + '.intro' | t }}</p>
      @for (section of sections(); track section) {
        <section>
          <h2>{{ 'info.' + page() + '.' + section + '.title' | t }}</h2>
          <p>{{ 'info.' + page() + '.' + section + '.text' | t }}</p>
        </section>
      }
      <p class="support-link">
        {{ 'info.questions' | t }} <a routerLink="/support">{{ 'footer.support' | t }}</a>
      </p>
    </article>
  `,
  styles: `
    .info {
      max-width: 720px;
      margin: 0 auto;
    }
    h1 {
      font-family: var(--di-brand-font);
      font-size: clamp(24px, 4vw, 32px);
      margin: 8px 0;
    }
    .lead {
      color: var(--di-text-muted);
      font-size: 17px;
      margin: 0 0 24px;
    }
    section {
      padding: 16px 0;
      border-top: 1px solid rgba(168, 85, 247, 0.25);
    }
    h2 {
      color: var(--di-neon-cyan);
      font-size: 17px;
      margin: 0 0 8px;
    }
    p {
      line-height: 1.6;
      margin: 0;
    }
    .support-link {
      margin-top: 24px;
      color: var(--di-text-muted);
    }
  `,
})
export class Info {
  readonly page = input.required<InfoPageName>();
  protected readonly sections = computed(() => SECTIONS[this.page()]);
}
