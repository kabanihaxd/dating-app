import { FirebaseError } from 'firebase/app';
import { vi } from 'vitest';
import { firestoreErrorKey, isNetworkErrorKey, isPermissionDenied } from './firestore-errors';

describe('firestoreErrorKey', () => {
  it('переводит коды Firestore в ключи раздела errors', () => {
    expect(firestoreErrorKey(new FirebaseError('permission-denied', ''))).toBe('errors.permission');
    expect(firestoreErrorKey(new FirebaseError('unavailable', ''))).toBe('errors.network');
    expect(firestoreErrorKey(new FirebaseError('deadline-exceeded', ''))).toBe('errors.network');
    expect(firestoreErrorKey(new FirebaseError('resource-exhausted', ''))).toBe('errors.quota');
  });

  it('неизвестную ошибку показывает как errors.unknown', () => {
    // console.error подменяем, чтобы тест не мусорил в выводе.
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(firestoreErrorKey(new Error('boom'))).toBe('errors.unknown');
    log.mockRestore();
  });

  it('узнаёт сетевую ошибку и «нет доступа»', () => {
    expect(isNetworkErrorKey('errors.network')).toBe(true);
    expect(isNetworkErrorKey('errors.unknown')).toBe(false);
    expect(isPermissionDenied(new FirebaseError('permission-denied', ''))).toBe(true);
    expect(isPermissionDenied(new FirebaseError('unavailable', ''))).toBe(false);
  });
});
