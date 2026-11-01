import { Injectable, inject } from '@angular/core';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { AuthService } from '../auth/auth';
import { FIRESTORE } from '../firebase/firestore';

// Те же темы и длины проверяются в firestore.rules — другое сервер не примет.
export const SUPPORT_TOPICS = ['account', 'delete', 'bug', 'safety', 'other'] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];
export const SUPPORT_MESSAGE_MIN = 10;
export const SUPPORT_MESSAGE_MAX = 2000;

// Обращение в поддержку. Как и жалобы, его можно только создать: читает владелец проекта
// в Firebase Console. Писать можно и без входа — например, когда как раз не получается войти.
@Injectable({ providedIn: 'root' })
export class SupportService {
  private readonly db = inject(FIRESTORE);
  private readonly auth = inject(AuthService);

  async send(topic: SupportTopic, email: string, message: string): Promise<void> {
    await addDoc(collection(this.db, 'support'), {
      // uid — чтобы по обращению найти аккаунт (например, для удаления); у гостя его нет.
      uid: this.auth.user()?.uid ?? null,
      email,
      topic,
      message,
      createdAt: serverTimestamp(),
    });
  }
}
