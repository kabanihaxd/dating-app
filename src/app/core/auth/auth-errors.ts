import { FirebaseError } from 'firebase/app';

// Firebase возвращает коды ошибок вроде 'auth/email-already-in-use'.
// Превращаем их в ключи переводов, чтобы показать понятный текст на языке пользователя.
// null — ошибку показывать не нужно (например, человек сам закрыл окно Google).
export function authErrorKey(error: unknown): string | null {
  const code = error instanceof FirebaseError ? error.code : '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'auth.errors.invalidCredential';
    case 'auth/invalid-email':
      return 'auth.errors.invalidEmail';
    case 'auth/email-already-in-use':
      return 'auth.errors.emailInUse';
    case 'auth/weak-password':
      return 'auth.errors.weakPassword';
    case 'auth/too-many-requests':
      return 'auth.errors.tooManyRequests';
    case 'auth/network-request-failed':
      return 'auth.errors.network';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null;
    default:
      // Неожиданная ошибка (например, неверный firebase.config.ts) — подробности в консоли браузера (F12).
      console.error(error);
      return 'auth.errors.unknown';
  }
}
