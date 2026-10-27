import { Injectable, inject } from '@angular/core';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { FIRESTORE } from '../firebase/firestore';

// Такой же лимит стоит в firestore.rules — сервер не пропустит сообщение длиннее.
export const MAX_MESSAGE_LENGTH = 1000;

// Сколько последних сообщений показываем. Для учебного чата хватит; длинную историю
// подгружали бы порциями при прокрутке вверх.
const MESSAGES_LIMIT = 100;

export interface ChatMessage {
  id: string;
  from: string;
  text: string;
  createdAt: Date | null;
}

// Чат живёт внутри мэтча: matches/{matchId}/messages/{messageId}.
// Так правилам легко проверить доступ: писать и читать могут только двое из matches/{matchId}.users.
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly db = inject(FIRESTORE);

  // uid собеседника, или null — мэтча нет (или он не наш: правила тогда вернут ошибку доступа).
  async loadPartner(matchId: string, me: string): Promise<string | null> {
    const snapshot = await getDoc(doc(this.db, 'matches', matchId)).catch(() => null);
    const users = snapshot?.exists() ? (snapshot.get('users') as string[]) : [];
    return users.includes(me) ? users.find((uid) => uid !== me)! : null;
  }

  // Подписка на последние сообщения: onMessages вызывается сразу и потом при каждом новом сообщении.
  // Возвращает функцию отписки — её нужно вызвать при уходе со страницы.
  watchMessages(
    matchId: string,
    onMessages: (messages: ChatMessage[]) => void,
    onError: (error: unknown) => void,
  ): () => void {
    // orderBy + limitToLast = «последние 100, от старых к новым» — как и показываем в чате.
    const messages = query(
      collection(this.db, 'matches', matchId, 'messages'),
      orderBy('createdAt'),
      limitToLast(MESSAGES_LIMIT),
    );
    return onSnapshot(
      messages,
      (snapshot) =>
        onMessages(
          snapshot.docs.map((message) => ({
            id: message.id,
            from: message.get('from') as string,
            text: message.get('text') as string,
            // Своё сообщение появляется на экране ДО ответа сервера, и времени у него ещё нет.
            // 'estimate' подставляет примерное время, чтобы его можно было сразу показать.
            createdAt:
              (
                message.get('createdAt', { serverTimestamps: 'estimate' }) as Timestamp | null
              )?.toDate() ?? null,
          })),
        ),
      onError,
    );
  }

  // Сообщение и превью в мэтче (lastMessage) сохраняем одним batch — либо оба, либо ничего.
  // Превью нужно списку мэтчей и уведомлениям: им не придётся читать всю переписку.
  send(matchId: string, from: string, text: string): Promise<void> {
    const message = { from, text, createdAt: serverTimestamp() };
    const batch = writeBatch(this.db);
    batch.set(doc(collection(this.db, 'matches', matchId, 'messages')), message);
    batch.update(doc(this.db, 'matches', matchId), { lastMessage: message });
    return batch.commit();
  }

  // «Прочитано»: запоминаем время в самом мэтче — readAt.{uid}. Точка в имени поля значит
  // «поле внутри объекта»: меняем только своё время, не трогая время собеседника.
  markRead(matchId: string, me: string): Promise<void> {
    return updateDoc(doc(this.db, 'matches', matchId), { [`readAt.${me}`]: serverTimestamp() });
  }
}
