import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { NotificationService } from '../../core/notifications/notifications';

// Меню вошедшего пользователя со значками уведомлений.
// Шапка подключает его через @defer, поэтому код Firestore не утяжеляет первую загрузку сайта.
@Component({
  selector: 'app-main-nav',
  imports: [
    RouterLink,
    RouterLinkActive,
    MatBadgeModule,
    MatButtonModule,
    MatIconModule,
    TranslatePipe,
  ],
  templateUrl: './main-nav.html',
  styleUrl: './main-nav.scss',
})
export class MainNav {
  private readonly notifications = inject(NotificationService);

  // Пункты меню храним массивом — шаблон выводит их через @for.
  // badge — сколько непросмотренного; 0 — значок скрыт.
  protected readonly navItems = computed(() => [
    {
      path: '/feed',
      icon: 'sports_esports',
      labelKey: 'nav.feed',
      badge: this.notifications.pendingLikes(),
    },
    {
      path: '/matches',
      icon: 'favorite',
      labelKey: 'nav.matches',
      badge: this.notifications.matchesBadge(),
    },
    { path: '/profile', icon: 'person', labelKey: 'nav.profile', badge: 0 },
  ]);
}
