import { Injectable, inject } from '@angular/core';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { FIRESTORE } from '../firebase/firestore';
import { matchId } from '../matching/swipes';

// Те же причины перечислены в firestore.rules — другую сервер не примет.
export const REPORT_REASONS = ['fake', 'spam', 'offensive', 'underage', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

// Batch вмещает максимум 500 операций — переписку удаляем порциями.
const BATCH_LIMIT = 500;

// Блокировки, жалобы и разрыв мэтча. Все проверки «можно ли» дублируются в firestore.rules.
@Injectable({ providedIn: 'root' })
export class ModerationService {
  private readonly db = inject(FIRESTORE);

  // Разорвать мэтч: сначала переписка, потом сам мэтч. Порядок важен: правила проверяют
  // право удалить сообщение по документу мэтча — после его удаления сообщения уже не стереть.
  async unmatch(me: string, other: string): Promise<void> {
    const matchRef = doc(this.db, 'matches', matchId(me, other));
    const messages = (await getDocs(collection(matchRef, 'messages'))).docs;
    for (let i = 0; i < messages.length; i += BATCH_LIMIT) {
      const batch = writeBatch(this.db);
      messages.slice(i, i + BATCH_LIMIT).forEach((message) => batch.delete(message.ref));
      await batch.commit();
    }
    await deleteDoc(matchRef);
  }

  // Блокировка: сначала сама запись (она главное — с ней правила уже не дадут создать мэтч),
  // потом, если мэтч был, удаляем его вместе с перепиской.
  async block(me: string, other: string): Promise<void> {
    await setDoc(doc(this.db, 'blocks', `${me}_${other}`), {
      from: me,
      to: other,
      createdAt: serverTimestamp(),
    });
    if (await this.isMatched(me, other)) {
      await this.unmatch(me, other);
    }
  }

  // addDoc сам придумывает id документа — жалоб на одного человека может быть несколько.
  async report(me: string, other: string, reason: ReportReason, comment: string): Promise<void> {
    await addDoc(collection(this.db, 'reports'), {
      from: me,
      to: other,
      reason,
      comment,
      createdAt: serverTimestamp(),
    });
  }

  // Несуществующий мэтч правила прочитать не дают (ошибка доступа) — это тоже значит «мэтча нет».
  private isMatched(me: string, other: string): Promise<boolean> {
    return getDoc(doc(this.db, 'matches', matchId(me, other)))
      .then((snapshot) => snapshot.exists())
      .catch(() => false);
  }
}
