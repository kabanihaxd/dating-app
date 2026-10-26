import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { FIREBASE_AUTH } from '../firebase/firebase';
import { I18n } from '../i18n/i18n';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(FIREBASE_AUTH);
  private readonly i18n = inject(I18n);

  private readonly currentUser = signal<User | null>(null);
  readonly user = this.currentUser.asReadonly();
  readonly isLoggedIn = computed(() => this.user() !== null);

  // После перезагрузки страницы Firebase восстанавливает сессию не мгновенно.
  // ready выполнится, когда станет точно известно, вошёл пользователь или нет, — его ждут guards.
  readonly ready: Promise<void>;

  constructor() {
    this.ready = new Promise((resolve) => {
      // Firebase сам вызывает этот колбэк при входе, выходе и восстановлении сессии.
      onAuthStateChanged(this.auth, (user) => {
        this.currentUser.set(user);
        resolve();
      });
    });

    // effect перезапускается при смене языка: окно Google и письма Firebase будут на языке сайта.
    effect(() => {
      this.auth.languageCode = this.i18n.lang();
    });
  }

  async register(email: string, password: string): Promise<void> {
    await createUserWithEmailAndPassword(this.auth, email, password);
  }

  async login(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email, password);
  }

  async loginWithGoogle(): Promise<void> {
    await signInWithPopup(this.auth, new GoogleAuthProvider());
  }

  logout(): Promise<void> {
    return signOut(this.auth);
  }
}
