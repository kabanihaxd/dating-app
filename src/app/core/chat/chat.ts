import { Injectable, inject } from '@angular/core';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { isPermissionDenied } from '../firebase/firestore-errors';
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
  // Другие ошибки (нет сети) пробрасываем дальше: это не «чата нет», а «попробуй ещё раз».
  async loadPartner(matchId: string, me: string): Promise<string | null> {
    const snapshot = await getDoc(doc(this.db, 'matches', matchId)).catch((error: unknown) => {
      if (isPermissionDenied(error)) {
        return null;
      }
      throw error;
    });
    const users = snapshot?.exists() ? (snapshot.get('users') as string[]) : [];
    return users.includes(me) ? users.find((uid) => uid !== me)! : null;
  }

  // Есть ли мэтч НА СЕРВЕРЕ прямо сейчас. getDocFromServer идёт мимо локального кэша:
  // кэш без сети может «не знать» документа, а нам нужен точный ответ — завершён ли чат.
  // permission-denied здесь значит «документа нет»: правила читают resource.data, а у удалённого
  // мэтча его нет. Сетевые ошибки пробрасываем — «не смогли проверить» не то же самое, что «мэтча нет».
  async matchExists(matchId: string): Promise<boolean> {
    try {
      const snapshot = await getDocFromServer(doc(this.db, 'matches', matchId));
      return snapshot.exists();
    } catch (error) {
      if (isPermissionDenied(error)) {
        return false;
      }
      throw error;
    }
  }

  // Подписка на сам документ мэтча: onGone вызывается, когда сервер ответил «документа нет» —
  // собеседник разорвал мэтч или заблокировал. Ошибки (в том числе ошибку доступа) отдаём в onError:
  // ошибка доступа ЧАСТО значит удалённый мэтч, но не всегда — страница перепроверит через matchExists.
  watchMatch(matchId: string, onGone: () => void, onError: (error: unknown) => void): () => void {
    return onSnapshot(
      doc(this.db, 'matches', matchId),
      (snapshot) => {
        // fromCache: без сети Firestore может ответить «документа нет» просто потому, что его нет
        // в локальном кэше. Верим только ответу сервера.
        if (!snapshot.exists() && !snapshot.metadata.fromCache) {
          onGone();
        }
      },
      onError,
    );
  }

  // Подписка на последние сообщения: onMessages вызывается сразу и потом при каждом новом сообщении.
  // Возвращает функцию отписки — её нужно вызвать при уходе со страницы.
  // fromCache — снимок собран из локального кэша, а не получен с сервера. Первый такой снимок
  // бывает пустым просто потому, что кэш ещё пуст, — странице важно отличать его от «переписки нет».
  watchMessages(
    matchId: string,
    onMessages: (messages: ChatMessage[], fromCache: boolean) => void,
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
          snapshot.metadata.fromCache,
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
