import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth';

// Guard — функция, которую роутер вызывает перед открытием страницы.
// true — пускаем; UrlTree — перенаправляем на другой адрес.
// inject() вызываем до await: после него контекст DI уже недоступен.

// Только для вошедших. Остальных отправляем на /login и запоминаем, куда они хотели попасть.
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready;
  return auth.isLoggedIn() || router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

// Только для гостей: вошедшему пользователю страница входа не нужна.
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready;
  return !auth.isLoggedIn() || router.createUrlTree(['/feed']);
};
