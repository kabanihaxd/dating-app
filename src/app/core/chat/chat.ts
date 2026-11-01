import { Injectable, inject } from '@angular/core';
import {
  Timestamp,
  collection,
  deleteField,
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
  // Приглашение поиграть, собранное кнопкой «Позвать играть» (поле kind: 'invite' в базе).
  // Метка не зависит от языка: приглашение на русском узнаётся и в украинском интерфейсе.
  invite: boolean;
  // Автор поправил текст после отправки (поле editedAt в базе) — у пузыря подпись «изменено».
  edited: boolean;
  // Автор отменил отправку (deleted: true): текст стёрт с сервера, на месте пузыря — «Сообщение удалено».
  deleted: boolean;
  // true — сообщение пока есть только в локальном кэше: Firestore показал его сразу,
  // но сервер ещё не подтвердил запись (медленная сеть или её нет вовсе).
  // По этому флагу чат рисует «часики» вместо галочки.
  pending: boolean;
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
  // onPartnerRead получает, когда собеседник последний раз открывал чат (readAt второго участника,
  // 0 — ни разу): по нему у моих сообщений галочка «Прочитано».
  watchMatch(
    matchId: string,
    me: string,
    onGone: () => void,
    onError: (error: unknown) => void,
    onPartnerRead: (at: number) => void = () => {},
  ): () => void {
    return onSnapshot(
      doc(this.db, 'matches', matchId),
      (snapshot) => {
        // fromCache: без сети Firestore может ответить «документа нет» просто потому, что его нет
        // в локальном кэше. Верим только ответу сервера.
        if (!snapshot.exists() && !snapshot.metadata.fromCache) {
          onGone();
          return;
        }
        const readAt = (snapshot.get('readAt') ?? {}) as Record<string, Timestamp | null>;
        const partner = Object.entries(readAt).find(([uid]) => uid !== me)?.[1];
        onPartnerRead(partner?.toMillis?.() ?? 0);
      },
      onError,
    );
  }

  // Подписка на последние сообщения: onMessages вызывается сразу и потом при каждом новом сообщении.
  // Возвращает функцию отписки — её нужно вызвать при уходе со страницы.
  // fromCache — снимок собран из локального кэша, а не получен с сервера. Первый такой снимок
  // бывает пустым просто потому, что кэш ещё пуст, — странице важно отличать его от «переписки нет».
  // includeMetadataChanges: true — снимок приходит и тогда, когда поменялись только «служебные»
  // данные: например, сервер подтвердил моё сообщение и hasPendingWrites стал false.
  // Без этой опции «часики» у отправленного сообщения так и не сменились бы галочкой.
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
      { includeMetadataChanges: true },
      (snapshot) =>
        onMessages(
          snapshot.docs.map((message) => ({
            id: message.id,
            from: message.get('from') as string,
            text: message.get('text') as string,
            invite: message.get('kind') === 'invite',
            edited: message.get('editedAt') != null,
            deleted: message.get('deleted') === true,
            // Своё сообщение появляется на экране ДО ответа сервера, и времени у него ещё нет.
            // 'estimate' подставляет примерное время, чтобы его можно было сразу показать.
            createdAt:
              (
                message.get('createdAt', { serverTimestamps: 'estimate' }) as Timestamp | null
              )?.toDate() ?? null,
            pending: message.metadata.hasPendingWrites,
          })),
          snapshot.metadata.fromCache,
        ),
      onError,
    );
  }

  // Сообщение и превью в мэтче (lastMessage) сохраняем одним batch — либо оба, либо ничего.
  // Превью нужно списку мэтчей и уведомлениям: им не придётся читать всю переписку.
  // invite — пометить сообщение как приглашение поиграть (kind: 'invite'); превью метка не нужна.
  send(matchId: string, from: string, text: string, invite = false): Promise<void> {
    const message = { from, text, createdAt: serverTimestamp() };
    const batch = writeBatch(this.db);
    batch.set(
      doc(collection(this.db, 'matches', matchId, 'messages')),
      invite ? { ...message, kind: 'invite' } : message,
    );
    batch.update(doc(this.db, 'matches', matchId), { lastMessage: message });
    return batch.commit();
  }

  // Правка своего сообщения: новый текст и время правки (editedAt). Время отправки (createdAt)
  // не трогаем — сообщение остаётся на своём месте в переписке.
  // last — это последнее сообщение чата: тогда поправляем и превью в мэтче (см. updatePreview).
  async edit(matchId: string, messageId: string, text: string, last: boolean): Promise<void> {
    await updateDoc(doc(this.db, 'matches', matchId, 'messages', messageId), {
      text,
      editedAt: serverTimestamp(),
    });
    if (last) {
      await this.updatePreview(matchId, { 'lastMessage.text': text });
    }
  }

  // «Отменить отправку»: сообщение не удаляем, а помечаем deleted и стираем текст. Документ
  // остаётся, поэтому у собеседника на его месте — «Сообщение удалено», а не дыра в переписке;
  // и чат не путает это с разрывом мэтча (там сообщения исчезают целиком, см. страницу чата).
  // kind убираем: от удалённого приглашения не должно остаться карточки «Позвать играть».
  async unsend(matchId: string, messageId: string, last: boolean): Promise<void> {
    await updateDoc(doc(this.db, 'matches', matchId, 'messages', messageId), {
      text: '',
      deleted: true,
      kind: deleteField(),
    });
    if (last) {
      await this.updatePreview(matchId, { 'lastMessage.text': '', 'lastMessage.deleted': true });
    }
  }

  // Превью правим отдельной записью и по полям (точка в имени — поле внутри lastMessage):
  // createdAt превью остаётся прежним, поэтому правка не выглядит «новым сообщением» —
  // ни всплывашки, ни розовой точки «непрочитано» у собеседника.
  // Отдельно, а не одним batch с сообщением: пока мы правили, собеседник мог успеть ответить,
  // превью уже не наше, и правила его не дадут поменять. Это не повод отменять саму правку.
  private async updatePreview(matchId: string, fields: Record<string, unknown>): Promise<void> {
    await updateDoc(doc(this.db, 'matches', matchId), fields).catch((error: unknown) => {
      if (!isPermissionDenied(error)) {
        throw error;
      }
    });
  }

  // «Прочитано»: запоминаем время в самом мэтче — readAt.{uid}. Точка в имени поля значит
  // «поле внутри объекта»: меняем только своё время, не трогая время собеседника.
  markRead(matchId: string, me: string): Promise<void> {
    return updateDoc(doc(this.db, 'matches', matchId), { [`readAt.${me}`]: serverTimestamp() });
  }
}
