import { InjectionToken, inject } from '@angular/core';
import { Firestore, getFirestore } from 'firebase/firestore';
import { FIREBASE_APP } from './firebase';

// Отдельный файл, а не provideFirebase(): код Firestore довольно большой.
// Токен с providedIn: 'root' попадает только в те lazy-страницы, которые его используют,
// поэтому главная и страница входа загружаются без него.
export const FIRESTORE = new InjectionToken<Firestore>('FIRESTORE', {
  providedIn: 'root',
  factory: () => getFirestore(inject(FIREBASE_APP)),
});
