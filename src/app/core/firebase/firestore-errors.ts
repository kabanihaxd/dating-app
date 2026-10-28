import { FirebaseError } from 'firebase/app';

// Как authErrorKey, только для базы данных: код ошибки Firestore → ключ перевода из раздела errors.
// Одна функция на все страницы — значит, и тексты ошибок везде одинаковые.
export function firestoreErrorKey(error: unknown): string {
  const code = error instanceof FirebaseError ? error.code : '';
  switch (code) {
    case 'permission-denied':
      return 'errors.permission';
    // unavailable — нет сети или сервер не отвечает; deadline-exceeded — ответ шёл слишком долго.
    case 'unavailable':
    case 'deadline-exceeded':
      return 'errors.network';
    // Бесплатный тариф Spark: исчерпан дневной лимит чтений/записей.
    case 'resource-exhausted':
      return 'errors.quota';
    case 'unauthenticated':
      return 'errors.unauthenticated';
    default:
      // Неожиданная ошибка — подробности в консоли браузера (F12).
      console.error(error);
      return 'errors.unknown';
  }
}

// Сетевая ли это ошибка — по ней выбираем иконку «облако перечёркнуто» вместо «восклицательного знака».
export function isNetworkErrorKey(key: string): boolean {
  return key === 'errors.network';
}

// «Нет доступа» по правилам Firestore. Часто значит не поломку, а «этого документа для тебя нет»
// (например, чужой или удалённый мэтч).
export function isPermissionDenied(error: unknown): boolean {
  return error instanceof FirebaseError && error.code === 'permission-denied';
}
