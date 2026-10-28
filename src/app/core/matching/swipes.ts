import { Injectable, inject } from '@angular/core';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { FIRESTORE } from '../firebase/firestore';

// Сколько раз пробовать создать мэтч и пауза между попытками (растёт: 0,5 с, потом 1 с).
const MATCH_ATTEMPTS = 3;
const MATCH_RETRY_MS = 500;

// «Временные» ошибки — сеть, перегрузка, конфликт: через секунду запрос может и пройти.
function isTransient(error: unknown): boolean {
  return (
    error instanceof FirebaseError &&
    ['unavailable', 'deadline-exceeded', 'aborted', 'internal'].includes(error.code)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface Match {
  id: string;
  otherUid: string;
  createdAt: Date | null;
}

// id мэтча одинаковый для обоих: uid по алфавиту через '_'. Так не появится два мэтча на одну пару.
export function matchId(a: string, b: string): string {
  return [a, b].sort().join('_');
}

// «Свайпы»: лайки, пропуски и мэтчи. Все проверки «можно ли» дублируются в firestore.rules.
@Injectable({ providedIn: 'root' })
export class SwipeService {
  private readonly db = inject(FIRESTORE);

  // Кого я уже лайкнул или пропустил — их в ленте больше не показываем.
  async swipedUids(me: string): Promise<Set<string>> {
    const [likes, skips] = await Promise.all(
      ['likes', 'skips'].map((name) =>
        getDocs(query(collection(this.db, name), where('from', '==', me))),
      ),
    );
    return new Set([...likes.docs, ...skips.docs].map((swipe) => swipe.get('to') as string));
  }

  skip(me: string, other: string): Promise<void> {
    return setDoc(doc(this.db, 'skips', `${me}_${other}`), {
      from: me,
      to: other,
      createdAt: serverTimestamp(),
    });
  }

  // «Вернуть» пропуск: удаляем документ, и игрок снова появится в ленте. Правила разрешают
  // удалять только свои пропуски.
  unskip(me: string, other: string): Promise<void> {
    return deleteDoc(doc(this.db, 'skips', `${me}_${other}`));
  }

  // Ставим лайк и смотрим, не лайкнул ли нас этот человек раньше. Если да — создаём мэтч.
  // Возвращает true, если получился мэтч.
  //
  // Нас уже лайкнули — лайк и мэтч пишем одним batch: «всё или ничего», и не бывает
  // состояния «лайк есть, а мэтч потерялся». Правило мэтча проверяет лайки через existsAfter(),
  // поэтому видит и мой лайк из этого же batch'а.
  // Если batch не прошёл (например, лайк уже записан прошлой попыткой — «перезаписать» его нельзя),
  // идём запасным путём по шагам. like() можно безопасно повторить с начала
  // (PendingLikes повторяет его после обрыва — выхода из аккаунта, закрытой вкладки):
  //  - лайк уже записан прошлой попыткой — не ошибка, идём дальше;
  //  - мэтч уже создан (нами раньше или вторым человеком одновременно) — тоже не ошибка.
  async like(me: string, other: string): Promise<boolean> {
    if (await this.likedMe(me, other)) {
      try {
        await this.saveLikeAndMatch(me, other);
        return true;
      } catch {
        // Запасной путь ниже сам разберётся, что уже записано, а что нет.
      }
    }

    await this.saveLike(me, other);
    // Проверяем ещё раз ПОСЛЕ своего лайка: человек мог лайкнуть нас, пока мы писали.
    if (!(await this.likedMe(me, other))) {
      return false;
    }
    await this.createMatch(me, other);
    return true;
  }

  private async likedMe(me: string, other: string): Promise<boolean> {
    return (await getDoc(doc(this.db, 'likes', `${other}_${me}`))).exists();
  }

  private saveLikeAndMatch(me: string, other: string): Promise<void> {
    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'likes', `${me}_${other}`), {
      from: me,
      to: other,
      createdAt: serverTimestamp(),
    });
    // createdBy — кто лайкнул вторым и «собрал» мэтч (см. createMatch).
    batch.set(doc(this.db, 'matches', matchId(me, other)), {
      users: [me, other].sort(),
      createdBy: me,
      createdAt: serverTimestamp(),
    });
    return batch.commit();
  }

  // Лайк создаётся один раз: «обновлять» его правила не дают (allow create, без update).
  // Поэтому при повторе setDoc получит permission-denied — проверяем, не наш ли это лайк уже.
  private async saveLike(me: string, other: string): Promise<void> {
    const likeRef = doc(this.db, 'likes', `${me}_${other}`);
    try {
      await setDoc(likeRef, { from: me, to: other, createdAt: serverTimestamp() });
    } catch (error) {
      const existing = await getDoc(likeRef).catch(() => null);
      if (!existing?.exists()) {
        throw error;
      }
    }
  }

  // Мэтч — с несколькими попытками: лайк уже лежит в базе, и потерять из-за сбоя сети
  // сам мэтч обиднее всего — второй человек свой лайк уже поставил и ждёт.
  private async createMatch(me: string, other: string): Promise<void> {
    const users = [me, other].sort();
    const matchRef = doc(this.db, 'matches', matchId(me, other));
    for (let attempt = 1; ; attempt++) {
      try {
        // createdBy — кто лайкнул вторым и «собрал» мэтч. Уведомление получит другой человек:
        // создатель уже увидел «Это мэтч!» прямо в ленте.
        await setDoc(matchRef, { users, createdBy: me, createdAt: serverTimestamp() });
        return;
      } catch (error) {
        // Мэтч уже есть: его создал другой (оба лайкнули почти одновременно) или наша прошлая
        // попытка. Перезаписать его правила не дают (иначе стёрлась бы переписка) — и не надо.
        const existing = await getDoc(matchRef).catch(() => null);
        if (existing?.exists()) {
          return;
        }
        // permission-denied без мэтча — правила против (например, блокировка): повтор не поможет.
        if (!isTransient(error) || attempt >= MATCH_ATTEMPTS) {
          throw error;
        }
        await delay(MATCH_RETRY_MS * attempt);
      }
    }
  }

  // Мои мэтчи, новые — первыми. array-contains находит документы, где в массиве users есть я.
  async listMatches(me: string): Promise<Match[]> {
    const snapshot = await getDocs(
      query(collection(this.db, 'matches'), where('users', 'array-contains', me)),
    );
    return snapshot.docs
      .map((match) => {
        const users = match.get('users') as string[];
        const createdAt = match.get('createdAt') as Timestamp | null;
        return {
          id: match.id,
          otherUid: users.find((uid) => uid !== me)!,
          createdAt: createdAt?.toDate() ?? null,
        };
      })
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  }
}
