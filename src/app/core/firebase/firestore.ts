import { InjectionToken, inject } from '@angular/core';
import { Firestore, connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { USE_EMULATORS } from './emulator';
import { FIREBASE_APP } from './firebase';

// Отдельный файл, а не provideFirebase(): код Firestore довольно большой.
// Токен с providedIn: 'root' попадает только в те lazy-страницы, которые его используют,
// поэтому главная и страница входа загружаются без него.
export const FIRESTORE = new InjectionToken<Firestore>('FIRESTORE', {
  providedIn: 'root',
  factory: () => {
    const db = getFirestore(inject(FIREBASE_APP));
    // Тот же код, но данные и правила — в локальном эмуляторе (см. emulator.ts).
    if (USE_EMULATORS) {
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    return db;
  },
});
