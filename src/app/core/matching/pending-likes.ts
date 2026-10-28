import { DOCUMENT, Injectable, effect, inject, untracked } from '@angular/core';
import { AuthService } from '../auth/auth';
import { SwipeService } from './swipes';

// Чем закончился лайк: отменили «Вернуть», ушло приглашение или сразу получился мэтч.
export type LikeOutcome = 'cancelled' | 'sent' | 'matched';

// Сколько выход из аккаунта готов ждать, пока допишутся лайки. Обычно хватает доли секунды;
// без сети ждать вечно нельзя — человек нажал «Выйти» и должен выйти.
export const LOGOUT_FLUSH_MS = 3000;

// Ключ localStorage: лайки, которые начали отправлять, но не успели дописать (см. outbox ниже).
const OUTBOX_KEY = 'di-like-outbox';

// Лайк, который ждёт «окна отмены». Таймер можно поставить на паузу: left — сколько осталось.
interface Waiting {
  timer: ReturnType<typeof setTimeout> | undefined;
  left: number;
  startedAt: number;
  // Вызывается, когда время вышло и лайк пошёл на сервер (лента прячет «Вернуть»).
  onSending?: () => void;
  // Отдаём результат тому, кто поставил лайк.
  done: (outcome: Promise<LikeOutcome>) => void;
}

// Очередь отложенных лайков. Раньше она жила в самой ленте — и умирала вместе с ней:
// человек жмёт «Выйти» в первые секунды после лайка, лента закрывается, а выход из аккаунта
// не ждёт, пока лайк (и мэтч после него) допишется, — и мэтч терялся навсегда.
// Сервис живёт столько же, сколько вкладка (providedIn: 'root'), поэтому:
//  - уход с ленты не отменяет лайк, а отправляет его сразу (flush);
//  - «Выйти» ждёт flush() — до LOGOUT_FLUSH_MS — и только потом выходит;
//  - свернули или закрыли вкладку — тоже отправляем сразу;
//  - outbox в localStorage помнит лайки, которые начали отправлять, но не дождались ответа
//    (закрыли вкладку, вышли раньше, чем ответил сервер). При следующем входе этого же
//    человека отправка повторяется — SwipeService.like() можно безопасно повторять.
@Injectable({ providedIn: 'root' })
export class PendingLikes {
  private readonly swipes = inject(SwipeService);
  private readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);

  // Ключ — пара `${me}_${other}`: тот же вид, что у id лайка в базе.
  private readonly waiting = new Map<string, Waiting>();
  // Лайки, которые уже пишутся на сервер. flush() ждёт и их.
  private readonly inFlight = new Map<string, Promise<LikeOutcome>>();

  constructor() {
    // Вкладку свернули (на телефоне — переключились в другое приложение) или закрывают:
    // ждать конца «окна отмены» уже некому — отправляем.
    this.document.addEventListener('visibilitychange', () => {
      if (this.document.visibilityState === 'hidden') {
        void this.flush();
      }
    });
    this.document.defaultView?.addEventListener('pagehide', () => void this.flush());
    // Вернулась сеть — пробуем дописать то, что застряло.
    this.document.defaultView?.addEventListener('online', () => this.resumeOutbox());

    // Вошёл человек (или сессия восстановилась после перезагрузки) — дописываем его лайки,
    // оборванные в прошлый раз. untracked: effect зависит только от смены пользователя.
    effect(() => {
      const uid = this.auth.user()?.uid;
      if (uid) {
        untracked(() => this.resumeOutbox());
      }
    });
  }

  // Поставить лайк с «окном отмены» delayMs. Promise завершится, когда лайк запишется
  // (sent / matched), или сразу после cancel() — с 'cancelled'.
  schedule(
    me: string,
    other: string,
    delayMs: number,
    onSending?: () => void,
  ): Promise<LikeOutcome> {
    const key = pairKey(me, other);
    return new Promise<LikeOutcome>((resolve, reject) => {
      const entry: Waiting = {
        timer: undefined,
        left: delayMs,
        startedAt: 0,
        onSending,
        done: (outcome) => outcome.then(resolve, reject),
      };
      this.waiting.set(key, entry);
      this.start(key, entry);
    });
  }

  // Лайк без ожидания (тот человек уже лайкнул меня — это мэтч, отменять нечего).
  likeNow(me: string, other: string): Promise<LikeOutcome> {
    return this.send(me, other);
  }

  // «Отправить сейчас»: не ждать конца окна отмены.
  release(me: string, other: string): void {
    this.fire(pairKey(me, other));
  }

  // «Вернуть»: лайк ещё не ушёл — просто забываем его. false — отменять уже поздно.
  cancel(me: string, other: string): boolean {
    const key = pairKey(me, other);
    const entry = this.waiting.get(key);
    if (!entry) {
      return false;
    }
    clearTimeout(entry.timer);
    this.waiting.delete(key);
    entry.done(Promise.resolve('cancelled'));
    return true;
  }

  // Пауза: человек навёл мышь на строку, поставил фокус на «Вернуть» или нажал «Пауза».
  pause(me: string, other: string): void {
    const entry = this.waiting.get(pairKey(me, other));
    if (entry?.timer !== undefined) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
      entry.left = Math.max(0, entry.left - (Date.now() - entry.startedAt));
    }
  }

  resume(me: string, other: string): void {
    const key = pairKey(me, other);
    const entry = this.waiting.get(key);
    if (entry && entry.timer === undefined) {
      this.start(key, entry);
    }
  }

  // Отправить все ждущие лайки сразу и дождаться всех, что пишутся. timeoutMs — сколько
  // максимум ждать (без сети запись висела бы, пока сеть не вернётся). Ошибки здесь не
  // нужны: о них сообщит тот, кто ставил лайк, — flush() просто ждёт, чем бы ни кончилось.
  async flush(timeoutMs?: number): Promise<void> {
    for (const key of [...this.waiting.keys()]) {
      this.fire(key);
    }
    const all = Promise.allSettled([...this.inFlight.values()]);
    if (timeoutMs === undefined) {
      await all;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      all,
      new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs))),
    ]);
    clearTimeout(timer);
  }

  private start(key: string, entry: Waiting): void {
    entry.startedAt = Date.now();
    entry.timer = setTimeout(() => this.fire(key), entry.left);
  }

  // Время вышло (или нас поторопили): из «ждущих» — в «пишущиеся».
  private fire(key: string): void {
    const entry = this.waiting.get(key);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    this.waiting.delete(key);
    entry.onSending?.();
    const [me, other] = key.split('_');
    entry.done(this.send(me, other));
  }

  // Сама отправка. Пока она идёт, пара лежит в outbox: если вкладку закроют раньше ответа,
  // при следующем входе отправка повторится. Успех — из outbox убираем; ошибка — см. ниже.
  private send(me: string, other: string): Promise<LikeOutcome> {
    const key = pairKey(me, other);
    const running = this.inFlight.get(key);
    if (running) {
      return running;
    }
    updateOutbox((keys) => keys.add(key));
    const forget = () =>
      updateOutbox((keys) => {
        keys.delete(key);
        return keys;
      });
    const sending = this.swipes.like(me, other).then(
      (matched): LikeOutcome => {
        this.inFlight.delete(key);
        forget();
        return matched ? 'matched' : 'sent';
      },
      (error: unknown) => {
        this.inFlight.delete(key);
        // Человек всё ещё здесь — он увидит «Приглашение не отправлено» и карточку обратно,
        // повторять за него не нужно. А если он уже вышел (запись оборвал выход из аккаунта),
        // пара остаётся в outbox и допишется при его следующем входе.
        if (this.auth.user()?.uid === me) {
          forget();
        }
        throw error;
      },
    );
    this.inFlight.set(key, sending);
    return sending;
  }

  // Дописать оборванные отправки текущего пользователя. Чужие пары (другой аккаунт на этом
  // компьютере) не трогаем: писать от чужого имени правила всё равно не дадут.
  private resumeOutbox(): void {
    const uid = this.auth.user()?.uid;
    if (!uid) {
      return;
    }
    for (const key of readOutbox()) {
      const [me, other] = key.split('_');
      if (me === uid && other && !this.inFlight.has(key) && !this.waiting.has(key)) {
        // Мэтч, если он получится, человек увидит на странице «Мэтчи» — окно «Это мэтч!»
        // поверх случайной страницы через сутки после лайка только сбило бы с толку.
        this.send(me, other).catch((error) => console.error('Like retry failed', error));
      }
    }
  }
}

function pairKey(me: string, other: string): string {
  return `${me}_${other}`;
}

// localStorage может быть недоступен (приватный режим) — тогда outbox просто не работает,
// а всё остальное (flush при уходе и выходе) — работает.
function readOutbox(): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((key) => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

function updateOutbox(change: (keys: Set<string>) => Set<string>): void {
  try {
    const keys = change(readOutbox());
    if (keys.size) {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify([...keys]));
    } else {
      localStorage.removeItem(OUTBOX_KEY);
    }
  } catch {
    // Не получилось запомнить — не страшно.
  }
}
