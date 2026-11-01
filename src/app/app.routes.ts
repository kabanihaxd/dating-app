import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guards';
import { unsavedChangesGuard } from './core/guards/unsaved-changes.guard';

// loadComponent = lazy loading: код страницы скачивается только когда пользователь на неё заходит.
// canActivate — guards: проверка перед входом на страницу.
export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home').then((m) => m.Home) },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
  },
  {
    path: 'feed',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/feed/feed').then((m) => m.Feed),
  },
  {
    path: 'matches',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/matches/matches').then((m) => m.Matches),
  },
  {
    // :matchId — параметр адреса: /chat/abc_xyz. Компонент получит его как input matchId.
    path: 'chat/:matchId',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/chat/chat').then((m) => m.Chat),
  },
  {
    path: 'profile',
    canActivate: [authGuard],
    // canDeactivate — проверка перед УХОДОМ: не дадим молча потерять несохранённую анкету.
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/profile/profile').then((m) => m.Profile),
  },
  // Страницы из подвала. Три текстовые — один компонент: data.page попадает в его input page.
  ...(['rules', 'privacy', 'safety'] as const).map((page) => ({
    path: page,
    data: { page },
    loadComponent: () => import('./pages/info/info').then((m) => m.Info),
  })),
  // Поддержка открыта и без входа: написать часто нужно именно когда войти не получается.
  {
    path: 'support',
    loadComponent: () => import('./pages/support/support').then((m) => m.Support),
  },
  {
    path: '**',
    loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFound),
  },
];
