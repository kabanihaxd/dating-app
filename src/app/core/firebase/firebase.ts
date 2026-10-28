import { InjectionToken, inject, makeEnvironmentProviders } from '@angular/core';
import { FirebaseApp, initializeApp } from 'firebase/app';
import { Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import { USE_EMULATORS } from './emulator';
import { firebaseConfig } from './firebase.config';

// InjectionToken — «ярлык», по которому DI находит объект, у которого нет своего Angular-класса.
// Теперь в любом сервисе можно написать inject(FIREBASE_AUTH).
export const FIREBASE_APP = new InjectionToken<FirebaseApp>('FIREBASE_APP');
export const FIREBASE_AUTH = new InjectionToken<Auth>('FIREBASE_AUTH');

// Всё подключение Firebase одной строкой в app.config.ts: provideFirebase().
// useFactory вызывается один раз — при первом inject() этого токена.
export function provideFirebase() {
  return makeEnvironmentProviders([
    { provide: FIREBASE_APP, useFactory: () => initializeApp(firebaseConfig) },
    {
      provide: FIREBASE_AUTH,
      useFactory: () => {
        const auth = getAuth(inject(FIREBASE_APP));
        // Локальный эмулятор: аккаунты создаются на этом компьютере, настоящие не видны.
        if (USE_EMULATORS) {
          connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        }
        return auth;
      },
    },
  ]);
}
