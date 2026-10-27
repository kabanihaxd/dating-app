import { Injectable, inject } from '@angular/core';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { FIRESTORE } from '../firebase/firestore';

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

  // Ставим лайк и смотрим, не лайкнул ли нас этот человек раньше. Если да — создаём мэтч.
  // Возвращает true, если получился мэтч.
  async like(me: string, other: string): Promise<boolean> {
    await setDoc(doc(this.db, 'likes', `${me}_${other}`), {
      from: me,
      to: other,
      createdAt: serverTimestamp(),
    });

    const likeBack = await getDoc(doc(this.db, 'likes', `${other}_${me}`));
    if (!likeBack.exists()) {
      return false;
    }
    const users = [me, other].sort();
    const matchRef = doc(this.db, 'matches', matchId(me, other));
    // createdBy — кто лайкнул вторым и «собрал» мэтч. Уведомление получит другой человек:
    // создатель уже увидел «Это мэтч!» прямо в ленте.
    try {
      await setDoc(matchRef, { users, createdBy: me, createdAt: serverTimestamp() });
    } catch (error) {
      // Оба лайкнули почти одновременно, и мэтч уже создал другой. Перезаписать его правила
      // не дают (иначе стёрлась бы переписка) — значит, мэтч есть, всё в порядке.
      const existing = await getDoc(matchRef).catch(() => null);
      if (!existing?.exists()) {
        throw error;
      }
    }
    return true;
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
