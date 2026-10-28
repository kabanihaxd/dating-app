import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
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

  // Порядок важен: сначала уходим со страницы, и только потом выходим из аккаунта.
  // При уходе срабатывают «прощальные» действия страницы, которым нужен вошедший пользователь:
  // canDeactivate-guard профиля спрашивает про несохранённые правки, лента дописывает отложенный лайк.
  // Если guard навигацию отменил (нажали «Остаться»), из аккаунта не выходим:
  // человек передумал уходить, а значит, и выходить.
  protected async logout(): Promise<void> {
    await this.router.navigateByUrl('/');
    // Проверяем не результат navigateByUrl(), а где мы оказались: на главной он тоже вернёт false —
    // переход «на тот же адрес» Angular пропускает, хотя уходить никуда и не нужно.
    if (this.isHome()) {
      await this.auth.logout();
    }
  }

  // Путь без ?query и #fragment — главная, даже если в адресе остались параметры.
  private isHome(): boolean {
    return this.router.url.split(/[?#]/)[0] === '/';
  }
}
