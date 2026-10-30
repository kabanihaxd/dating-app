import { Component, Injector, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth/auth';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LanguageSwitcher } from '../language-switcher/language-switcher';
import { MainNav } from '../main-nav/main-nav';

@Component({
  selector: 'app-header',
  imports: [
    RouterLink,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    TranslatePipe,
    LanguageSwitcher,
    MainNav,
  ],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  // Открыт чат: на телефоне шапка там ниже (см. .compact в header.scss) — у чата своя шапка
  // с собеседником, и две полноразмерные шапки подряд отнимали бы у переписки почти 120px.
  protected readonly compact = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url.startsWith('/chat/')),
    ),
    { initialValue: this.router.url.startsWith('/chat/') },
  );
  // Выход уже идёт — второе нажатие ничего не делает (ждём лайки, потом signOut).
  private loggingOut = false;

  // Порядок важен: сначала уходим со страницы, и только потом выходим из аккаунта.
  // При уходе срабатывают «прощальные» действия страницы, которым нужен вошедший пользователь:
  // canDeactivate-guard профиля спрашивает про несохранённые правки, лента дописывает отложенный лайк.
  // Если guard навигацию отменил (нажали «Остаться»), из аккаунта не выходим:
  // человек передумал уходить, а значит, и выходить.
  // Лента, закрываясь, отправляет отложенные лайки, но сама запись идёт ещё долю секунды:
  // лайк, проверка «а он меня лайкнул?» и, может быть, мэтч. Выйди мы из аккаунта посреди
  // этого — запросы ушли бы уже без пользователя, и мэтч не создался бы. Поэтому ждём
  // flush() очереди лайков, но не дольше LOGOUT_FLUSH_MS: без сети человек всё равно должен
  // выйти, а недописанное повторится при его следующем входе (outbox в PendingLikes).
  protected async logout(): Promise<void> {
    if (this.loggingOut) {
      return;
    }
    this.loggingOut = true;
    try {
      await this.router.navigateByUrl('/');
      // Проверяем не результат navigateByUrl(), а где мы оказались: на главной он тоже вернёт
      // false — переход «на тот же адрес» Angular пропускает, хотя уходить никуда и не нужно.
      if (this.isHome()) {
        await this.flushLikes();
        await this.auth.logout();
      }
    } finally {
      this.loggingOut = false;
    }
  }

  // import() — код очереди лайков (а с ним и Firestore) шапка грузит только при выходе:
  // гость и страница входа без него обходятся. Если лента в этой вкладке уже открывалась,
  // файл давно скачан и сервис уже создан — inject вернёт тот же экземпляр с теми же лайками.
  private async flushLikes(): Promise<void> {
    try {
      const { PendingLikes, LOGOUT_FLUSH_MS } = await import('../../core/matching/pending-likes');
      await this.injector.get(PendingLikes).flush(LOGOUT_FLUSH_MS);
    } catch (error) {
      // Не скачался файл (нет сети) — выходим всё равно: недописанное лежит в outbox.
      console.error(error);
    }
  }

  // Путь без ?query и #fragment — главная, даже если в адресе остались параметры.
  private isHome(): boolean {
    return this.router.url.split(/[?#]/)[0] === '/';
  }
}
