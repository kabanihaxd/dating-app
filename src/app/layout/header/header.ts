import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LanguageSwitcher } from '../language-switcher/language-switcher';

@Component({
  selector: 'app-header',
  imports: [
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    TranslatePipe,
    LanguageSwitcher,
  ],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  // Пункты меню храним массивом — шаблон выводит их через @for.
  // Вместо текста — ключ перевода: сам текст берётся из public/i18n/<язык>.json.
  protected readonly navItems = [
    { path: '/feed', icon: 'sports_esports', labelKey: 'nav.feed' },
    { path: '/matches', icon: 'favorite', labelKey: 'nav.matches' },
    { path: '/profile', icon: 'person', labelKey: 'nav.profile' },
  ];
}
