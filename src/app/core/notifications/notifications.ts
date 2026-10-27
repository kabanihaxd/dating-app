import { Injectable, WritableSignal, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  DocumentSnapshot,
  Timestamp,
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { AuthService } from '../auth/auth';
import { FIRESTORE } from '../firebase/firestore';
import { I18n } from '../i18n/i18n';
import { ProfileService } from '../profile/profile';

const SEEN_KEY = 'di-matches-seen';
// Длинное сообщение во всплывашке обрезаем — целиком его покажет чат.
const TOAST_TEXT_LENGTH = 60;

export interface LastMessage {
  from: string;
  text: string;
  at: number; // мс с 1970 года — так время удобно сравнивать
}

// То, что уведомлениям нужно знать про один мэтч.
interface MatchSummary {
  id: string;
  createdAt: number;
  lastMessage: LastMessage | null;
  readAt: number; // когда Я последний раз открывал этот чат; 0 — ни разу
}

// Уведомления в реальном времени. getDocs читает базу один раз, а onSnapshot «подписывается»:
// Firebase сам присылает новые данные при каждом изменении — без перезагрузки страницы.
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly db = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(ProfileService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18n);
  private readonly router = inject(Router);

  private readonly likedMeUids = signal(new Set<string>());
  private readonly myLikes = signal(new Set<string>());
  private readonly mySkips = signal(new Set<string>());
  private readonly blockedByMe = signal(new Set<string>());
  private readonly blockedMe = signal(new Set<string>());
  private readonly matches = signal<MatchSummary[]>([]);
  private readonly matchesSeenAt = signal(0);

  // Какой чат сейчас открыт (id мэтча). Ставит страница чата: о сообщениях в нём всплывашка не нужна.
  readonly activeChat = signal<string | null>(null);

  // Скрытые люди: я заблокировал их или они меня. Их нет ни в ленте, ни в мэтчах, ни в уведомлениях.
  readonly hidden = computed(() => new Set([...this.blockedByMe(), ...this.blockedMe()]));

  // Кто лайкнул меня (uid). Лента показывает их первыми.
  readonly likedMe = this.likedMeUids.asReadonly();

  // Лайкнули меня, а я ещё не ответил: лайкну в ответ — сразу мэтч. Это число на значке «Анкеты».
  readonly pendingLikes = computed(
    () =>
      [...this.likedMeUids()].filter(
        (uid) => !this.myLikes().has(uid) && !this.mySkips().has(uid) && !this.hidden().has(uid),
      ).length,
  );

  // Последнее сообщение каждого чата: id мэтча → сообщение. Для превью на странице «Мэтчи».
  readonly lastMessages = computed(
    () =>
      new Map(
        this.matches().flatMap((match) =>
          match.lastMessage ? [[match.id, match.lastMessage] as const] : [],
        ),
      ),
  );

  // Чаты с непрочитанным: последнее сообщение от собеседника и пришло позже, чем я читал чат.
  readonly unreadChats = computed(() => {
    const me = this.auth.user()?.uid;
    return new Set(
      this.matches()
        .filter((m) => m.lastMessage && m.lastMessage.from !== me && m.lastMessage.at > m.readAt)
        .map((m) => m.id),
    );
  });

  // Значок «Мэтчи»: новые мэтчи (после последнего захода на страницу) + чаты с непрочитанным.
  readonly matchesBadge = computed(
    () =>
      this.matches().filter((match) => match.createdAt > this.matchesSeenAt()).length +
      this.unreadChats().size,
  );

  constructor() {
    // effect перезапускается при входе/выходе. onCleanup отписывает старые подписки —
    // иначе после выхода продолжали бы приходить уведомления прошлого пользователя.
    effect((onCleanup) => {
      const uid = this.auth.user()?.uid;
      if (!uid) {
        return;
      }
      this.matchesSeenAt.set(Number(this.storage()?.getItem(`${SEEN_KEY}-${uid}`) ?? 0));
      const unsubscribers = [
        this.watchLikesToMe(uid),
        this.watchSet('likes', 'from', uid, this.myLikes),
        this.watchSet('skips', 'from', uid, this.mySkips),
        this.watchSet('blocks', 'from', uid, this.blockedByMe),
        this.watchSet('blocks', 'to', uid, this.blockedMe),
        this.watchMatches(uid),
      ];
      onCleanup(() => {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
        this.likedMeUids.set(new Set());
        this.myLikes.set(new Set());
        this.mySkips.set(new Set());
        this.blockedByMe.set(new Set());
        this.blockedMe.set(new Set());
        this.matches.set([]);
      });
    });
  }

  // Вызывает страница «Мэтчи»: всё, что там видно, считается просмотренным.
  markMatchesSeen(): void {
    const uid = this.auth.user()?.uid;
    const now = Date.now();
    this.matchesSeenAt.set(now);
    if (uid) {
      this.storage()?.setItem(`${SEEN_KEY}-${uid}`, String(now));
    }
  }

  private watchLikesToMe(uid: string): () => void {
    let first = true;
    return onSnapshot(
      query(collection(this.db, 'likes'), where('to', '==', uid)),
      (snapshot) => {
        this.likedMeUids.set(new Set(snapshot.docs.map((like) => like.get('from') as string)));
        // Первый снимок — это лайки, которые уже были до открытия сайта. Уведомляем только о новых.
        if (!first) {
          snapshot
            .docChanges()
            .filter((change) => change.type === 'added')
            .forEach((change) =>
              this.notify('notifications.liked', change.doc.get('from'), '/feed'),
            );
        }
        first = false;
      },
      (error) => console.error(error),
    );
  }

  // Один и тот же снимок мэтчей даёт и значки, и всплывашки: о новом мэтче (added)
  // и о новом сообщении (modified — у мэтча поменялось поле lastMessage).
  private watchMatches(uid: string): () => void {
    let first = true;
    return onSnapshot(
      query(collection(this.db, 'matches'), where('users', 'array-contains', uid)),
      (snapshot) => {
        // Время прошлого последнего сообщения — чтобы отличить новое сообщение от других правок
        // мэтча (например, собеседник прочитал чат и обновил своё readAt).
        const previous = new Map(this.matches().map((m) => [m.id, m.lastMessage?.at ?? 0]));
        this.matches.set(snapshot.docs.map((match) => toSummary(match, uid)));
        if (first) {
          first = false;
          return;
        }
        for (const change of snapshot.docChanges()) {
          const other = (change.doc.get('users') as string[]).find((user) => user !== uid)!;
          if (change.type === 'added' && change.doc.get('createdBy') !== uid) {
            this.notify('notifications.matched', other, '/matches');
          }
          const message = toSummary(change.doc, uid).lastMessage;
          if (
            change.type === 'modified' &&
            message &&
            message.from !== uid &&
            message.at !== previous.get(change.doc.id) &&
            this.activeChat() !== change.doc.id
          ) {
            this.notify('notifications.message', other, `/chat/${change.doc.id}`, {
              text: shorten(message.text),
            });
          }
        }
      },
      (error) => console.error(error),
    );
  }

  // Документы {from, to}, где я — from (мои лайки, пропуски, блокировки) или to (блокировки меня)
  // → Set uid второго человека.
  private watchSet(
    name: 'likes' | 'skips' | 'blocks',
    side: 'from' | 'to',
    uid: string,
    target: WritableSignal<Set<string>>,
  ): () => void {
    const other = side === 'from' ? 'to' : 'from';
    return onSnapshot(
      query(collection(this.db, name), where(side, '==', uid)),
      (snapshot) => target.set(new Set(snapshot.docs.map((item) => item.get(other) as string))),
      (error) => console.error(error),
    );
  }

  private async notify(
    key: string,
    otherUid: string,
    link: string,
    params: Record<string, string> = {},
  ): Promise<void> {
    if (this.hidden().has(otherUid)) {
      return; // от заблокированных — никаких всплывашек
    }
    const profile = await this.profiles.loadPublic(otherUid).catch(() => null);
    const text = this.i18n.translate(key, { ...params, name: profile?.name ?? '' });
    this.snackBar
      .open(text, this.i18n.translate('notifications.view'), { duration: 6000 })
      .onAction()
      .subscribe(() => this.router.navigateByUrl(link));
  }

  private storage(): Storage | null {
    try {
      return localStorage;
    } catch {
      return null; // приватный режим браузера может запретить localStorage
    }
  }
}

// Документ мэтча → MatchSummary. Только что записанное время ещё не пришло с сервера —
// тогда берём примерное (estimate), иначе свежий мэтч или сообщение имели бы время 0.
function toSummary(match: DocumentSnapshot, uid: string): MatchSummary {
  const millis = (field: string) =>
    (match.get(field, { serverTimestamps: 'estimate' }) as Timestamp | undefined)?.toMillis() ?? 0;
  const lastMessage = match.get('lastMessage') as { from: string; text: string } | undefined;
  return {
    id: match.id,
    createdAt: millis('createdAt'),
    lastMessage: lastMessage
      ? { from: lastMessage.from, text: lastMessage.text, at: millis('lastMessage.createdAt') }
      : null,
    readAt: millis(`readAt.${uid}`),
  };
}

function shorten(text: string): string {
  return text.length > TOAST_TEXT_LENGTH ? `${text.slice(0, TOAST_TEXT_LENGTH)}…` : text;
}
