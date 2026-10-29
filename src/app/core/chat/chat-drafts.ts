import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../auth/auth';

// Ключ sessionStorage. Именно session-, а не localStorage: черновик должен пережить перезагрузку
// вкладки (случайный F5, телефон выгрузил вкладку из памяти), но не жить вечно — закрыл вкладку,
// и недописанные сообщения пропали, как в любом мессенджере.
const STORAGE_KEY = 'di-chat-drafts';

// Что лежит в хранилище: чьи это черновики (uid) и сами черновики по id мэтча.
// uid нужен, чтобы черновики одного аккаунта никогда не показались другому
// (вышел из аккаунта, в той же вкладке вошёл кто-то другой).
interface StoredDrafts {
  uid: string;
  drafts: Record<string, string>;
}

// Недописанные сообщения — отдельно для каждого чата.
// Раньше черновик жил в самом компоненте чата и пропадал, стоило выйти из переписки
// (назад к мэтчам, кнопка «Посмотреть» у уведомления о другом чате) — человек возвращался
// к пустому полю. Теперь компонент при открытии чата берёт отсюда черновик ИМЕННО этого мэтча
// (чужой текст в другую переписку не попадёт), а при каждом нажатии клавиши кладёт его обратно.
// providedIn: 'root' — сервис один на всё приложение и живёт дольше страницы чата.
@Injectable({ providedIn: 'root' })
export class ChatDrafts {
  private readonly auth = inject(AuthService);

  // Черновики текущего пользователя: { [matchId]: текст }. Пустые не храним вовсе.
  private readonly drafts = signal<Record<string, string>>({});
  // Чьи черновики сейчас в памяти. Сменился пользователь — память и хранилище чистим.
  private owner: string | null = null;

  constructor() {
    // Сразу, не дожидаясь effect: сервис создаётся, когда открывается чат, и тот в тот же момент
    // спрашивает свой черновик. effect запустился бы чуть позже — и первый get() вернул бы ''.
    this.switchOwner(this.auth.user()?.uid ?? null);
    // effect следит за входом/выходом. Вышел (uid стал null) или вошёл другой — черновики прошлого
    // аккаунта стираем отовсюду. Вошёл тот же (например, после перезагрузки) — достаём сохранённые.
    effect(() => {
      const uid = this.auth.user()?.uid ?? null;
      // untracked — чтение и запись сигнала drafts внутри не должны перезапускать этот effect.
      untracked(() => this.switchOwner(uid));
    });
  }

  // Черновик чата или '' — если его нет.
  get(matchId: string): string {
    return this.drafts()[matchId] ?? '';
  }

  // Запомнить текст из поля ввода. Пустой (или из одних пробелов) — значит черновика нет:
  // удаляем запись, чтобы после отправки сообщения старый текст не «воскрес».
  set(matchId: string, text: string): void {
    if (!this.owner) {
      return;
    }
    const current = this.drafts();
    const keep = text.trim() !== '';
    if (keep ? current[matchId] === text : !(matchId in current)) {
      return;
    }
    const next = { ...current };
    if (keep) {
      next[matchId] = text;
    } else {
      delete next[matchId];
    }
    this.drafts.set(next);
    this.save();
  }

  private switchOwner(uid: string | null): void {
    if (uid === this.owner) {
      return;
    }
    this.owner = uid;
    if (!uid) {
      // Выход из аккаунта: черновики не должны дожить до следующего входа (вдруг это общий компьютер).
      this.drafts.set({});
      this.remove();
      return;
    }
    const stored = this.load();
    // Сохранено другим аккаунтом — не показываем и сразу выбрасываем.
    if (stored && stored.uid !== uid) {
      this.remove();
    }
    this.drafts.set(stored?.uid === uid ? stored.drafts : {});
  }

  // sessionStorage может быть недоступен (приватный режим, запрет сайтовых данных) или испорчен —
  // тогда черновики просто живут только в памяти до перезагрузки, а чат работает как обычно.
  private load(): StoredDrafts | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<StoredDrafts>;
      if (typeof parsed?.uid !== 'string' || typeof parsed.drafts !== 'object' || !parsed.drafts) {
        return null;
      }
      // Оставляем только строки: в хранилище мог оказаться мусор из старой версии приложения.
      const drafts: Record<string, string> = {};
      for (const [matchId, text] of Object.entries(parsed.drafts)) {
        if (typeof text === 'string' && text.trim()) {
          drafts[matchId] = text;
        }
      }
      return { uid: parsed.uid, drafts };
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      const drafts = this.drafts();
      if (!this.owner || Object.keys(drafts).length === 0) {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      const stored: StoredDrafts = { uid: this.owner, drafts };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Хранилище переполнено или запрещено — черновик всё равно остаётся в памяти.
    }
  }

  private remove(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Нет доступа к хранилищу — значит, и стирать там нечего.
    }
  }
}
