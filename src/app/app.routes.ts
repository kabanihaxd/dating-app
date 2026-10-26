import { Routes } from '@angular/router';

// loadComponent = lazy loading: код страницы скачивается только когда пользователь на неё заходит.
export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home').then((m) => m.Home) },
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.Login) },
  { path: 'feed', loadComponent: () => import('./pages/feed/feed').then((m) => m.Feed) },
  { path: 'matches', loadComponent: () => import('./pages/matches/matches').then((m) => m.Matches) },
  { path: 'profile', loadComponent: () => import('./pages/profile/profile').then((m) => m.Profile) },
  { path: '**', loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFound) },
];
