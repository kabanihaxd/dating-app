import { Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
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
  private readonly router = inject(Router);

  // Открыт ли сейчас чат (/chat/…). Чат — часть раздела «Мэтчи»: в него попадают из списка мэтчей
  // и возвращаются туда же. routerLinkActive подсвечивает пункт только для его собственного адреса,
  // поэтому для чата подсвечиваем «Мэтчи» сами — иначе внутри чата меню не говорило бы, где ты.
  // toSignal превращает поток событий роутера в сигнал; initialValue — адрес на момент создания меню.
  protected readonly inChat = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => isChatUrl(this.router.url)),
    ),
    { initialValue: isChatUrl(this.router.url) },
  );

  // Пункты меню храним массивом — шаблон выводит их через @for.
  // badge — сколько непросмотренного; 0 — значок скрыт.
  protected readonly navItems = computed(() => [
    {
      path: '/feed',
      icon: 'sports_esports',
      labelKey: 'nav.feed',
      badge: this.notifications.pendingLikes(),
      section: false,
    },
    {
      path: '/matches',
      icon: 'favorite',
      labelKey: 'nav.matches',
      badge: this.notifications.matchesBadge(),
      // Подсвечен и внутри чата (см. inChat).
      section: this.inChat(),
    },
    { path: '/profile', icon: 'person', labelKey: 'nav.profile', badge: 0, section: false },
  ]);
}

// Адрес чата — /chat/<id>, возможно с ?параметрами или #якорем.
// Не экспортируем: шапка грузит этот файл через @defer, и импорт отсюда в шапку
// затащил бы весь код меню в основной файл приложения.
function isChatUrl(url: string): boolean {
  return url.startsWith('/chat/');
}
