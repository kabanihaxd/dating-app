import {
  Component,
  DOCUMENT,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../core/auth/auth';
import { firestoreErrorKey } from '../../core/firebase/firestore-errors';
import { I18n } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { matchScore } from '../../core/matching/match-score';
import { LiveMatch, NotificationService } from '../../core/notifications/notifications';
import { ProfileService } from '../../core/profile/profile';
import {
  CONTACT_FIELDS,
  CONTACT_SITES,
  ContactField,
  UserContacts,
  UserProfile,
  ageFrom,
  isProfileLink,
} from '../../core/profile/profile.model';
import { ErrorState } from '../../shared/error-state/error-state';
import { ModerationMenu } from '../../shared/moderation-menu/moderation-menu';
import { StateMessage } from '../../shared/state-message/state-message';

// Всё, что нужно шаблону про один мэтч, — посчитано заранее, чтобы в шаблоне не было логики.
interface MatchView {
  id: string; // id мэтча — он же адрес чата /chat/{id}
  uid: string;
  headingId: string; // id заголовка с именем: на него ссылается aria-labelledby карточки, туда же уходит фокус
  profile: UserProfile;
  age: number;
  commonGames: string[];
  contacts: { field: ContactField; value: string; isLink: boolean }[];
}

// Запись кэша карточек по uid — одно из трёх состояний. Это «размеченное объединение»
// (discriminated union): по полю state TypeScript сам понимает, какие ещё поля есть у записи.
// view — карточка готова; deleted — анкеты нет, показывать нечего;
// error — не удалось загрузить (сеть, сбой). Это НЕ «удалён»: такую карточку можно перезапросить.
type CardEntry =
  | { state: 'view'; view: MatchView }
  | { state: 'deleted' }
  | { state: 'error'; error: unknown };

@Component({
  selector: 'app-matches',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    TranslatePipe,
    ModerationMenu,
    ErrorState,
    StateMessage,
  ],
  templateUrl: './matches.html',
  styleUrl: './matches.scss',
})
export class Matches {
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(ProfileService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18n);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);

  // Сам список мэтчей, превью последнего сообщения и «непрочитано» берём из живой подписки
  // уведомлений (onSnapshot), поэтому всё это обновляется на странице само, без перезагрузки.
  protected readonly notifications = inject(NotificationService);
  protected readonly me = this.auth.user()!.uid;

  // Моя анкета нужна, чтобы посчитать общие игры. undefined — ещё грузится, null — анкеты нет.
  private readonly myProfile = signal<UserProfile | null | undefined>(undefined);
  // Кэш карточек по uid: анкету и контакты каждого игрока читаем один раз, а не на каждый
  // новый снимок мэтчей (новое сообщение тоже меняет снимок). Нет записи — ещё не загружена.
  private readonly cards = signal(new Map<string, CardEntry>());
  // uid, за которыми уже отправлен запрос, — чтобы не запрашивать одного и того же дважды.
  private readonly requested = new Set<string>();
  // uid, чей запрос сейчас «в полёте». Нужен, чтобы во время повтора показать загрузку,
  // а не ту же самую ошибку.
  private readonly inFlight = signal(new Set<string>());
  // Карточки, убранные через «⋮», прячем сразу, не дожидаясь, пока снимок из базы догонит.
  private readonly removedUids = signal(new Set<string>());
  // Первая партия карточек догружена. Это «защёлка»: один раз стала true — и всё. Дальше новые
  // мэтчи просто «доезжают» в сетку, а не возвращают всю страницу в скелетон.
  private readonly firstBatchLoaded = signal(false);
  private readonly profileErrorKey = signal<string | null>(null);
  // Счётчик повторов: увеличили — эффект ниже снова запускает sync() и дозапрашивает упавших.
  private readonly attempt = signal(0);
  // Когда я в прошлый раз заходил на «Мэтчи» — запоминаем ДО того, как отметить всё просмотренным.
  // Мэтчи новее этого момента получают метку «Новый».
  private readonly seenBefore: number;

  // Три серые заготовки карточек на время загрузки.
  protected readonly skeletons = [0, 1, 2];

  // Мэтчи, которые сейчас должны быть на странице: без скрытых (блокировки) и убранных через «⋮».
  private readonly shownList = computed(() => {
    const hidden = this.notifications.hidden();
    const removed = this.removedUids();
    return this.notifications
      .matchList()
      .filter((match) => !hidden.has(match.otherUid) && !removed.has(match.otherUid));
  });

  // uid карточек, которые не удалось загрузить.
  private readonly failedUids = computed(() => {
    const cards = this.cards();
    return this.shownList()
      .map((match) => match.otherUid)
      .filter((uid) => cards.get(uid)?.state === 'error');
  });
  protected readonly failedCount = computed(() => this.failedUids().length);
  // Повтор для упавших карточек уже идёт — кнопка «Попробовать ещё раз» ждёт результата.
  protected readonly retrying = computed(() => {
    const inFlight = this.inFlight();
    return this.failedUids().some((uid) => inFlight.has(uid));
  });

  // «Честный» порядок, посчитанный с нуля: сначала чаты с непрочитанным, потом по свежести —
  // последнее сообщение или сам мэтч. Здесь только uid, без карточек.
  private readonly liveOrder = computed(() => {
    const unread = this.notifications.unreadChats();
    const last = this.notifications.lastMessages();
    const activity = (match: LiveMatch) => Math.max(match.createdAt, last.get(match.id)?.at ?? 0);
    return [...this.shownList()]
      .sort(
        (a, b) => Number(unread.has(b.id)) - Number(unread.has(a.id)) || activity(b) - activity(a),
      )
      .map((match) => match.otherUid);
  });

  // Порядок, который реально видит пользователь. Пока страница грузится, он просто повторяет
  // liveOrder. Но как только карточки показаны (firstBatchLoaded), порядок «замораживается»
  // до следующего захода на страницу: уже стоящие карточки больше не переставляются.
  //
  // Зачем: каждое новое сообщение меняет liveOrder, и карточка прыгала бы наверх прямо из-под
  // курсора или фокуса — человек целился в «Копировать ник» у Ани, а под пальцем уже Катя.
  // Новое сообщение и так видно по розовой точке и превью, а свежий порядок человек получит,
  // когда откроет «Мэтчи» в следующий раз.
  // Это проще и надёжнее, чем следить «курсор/фокус внутри списка или нет»: заморозка
  // не зависит от того, чем человек пользуется (мышь, палец, клавиатура, скринридер), и не
  // устраивает «отложенный прыжок» в момент, когда курсор просто ушёл со списка.
  //
  // Новые мэтчи всё же добавляются — в начало списка, остальные карточки между собой не меняются.
  //
  // linkedSignal — сигнал, который пересчитывается от source, но в computation видит своё
  // ПРОШЛОЕ значение (previous). Ровно то, что нужно: «новый порядок = новички + старый».
  // Ушедшие uid из массива намеренно НЕ вычищаем: по ним focusNeighbour() находит соседей
  // карточки, которая уже исчезла (см. remove()). Отфильтровываются они в visibleMatches.
  private readonly order = linkedSignal<{ uids: string[]; frozen: boolean }, string[]>({
    source: () => ({ uids: this.liveOrder(), frozen: this.firstBatchLoaded() }),
    computation: ({ uids, frozen }, previous) => {
      if (!frozen || !previous) {
        return uids;
      }
      const known = new Set(previous.value);
      const newcomers = uids.filter((uid) => !known.has(uid));
      // Нет новичков — возвращаем тот же массив: сигнал не меняется, сетка не пересчитывается.
      return newcomers.length ? [...newcomers, ...previous.value] : previous.value;
    },
  });

  // Состав — из живого списка мэтчей, данные карточки — из кэша, порядок — замороженный order.
  // Если мэтч разорвали или меня заблокировали, пока страница открыта, — карточка исчезает сама.
  protected readonly visibleMatches = computed(() => {
    const cards = this.cards();
    const shown = new Set(this.shownList().map((match) => match.otherUid));
    return this.order().flatMap((uid) => {
      const entry = shown.has(uid) ? cards.get(uid) : undefined;
      return entry?.state === 'view' ? [entry.view] : [];
    });
  });

  // id мэтчей, случившихся после моего прошлого захода, — им метка «Новый».
  protected readonly newMatchIds = computed(
    () =>
      new Set(
        this.notifications
          .matchList()
          .filter((match) => match.createdAt > this.seenBefore)
          .map((match) => match.id),
      ),
  );

  // Ни одной карточки показать нельзя, а упавшие есть — это ошибка страницы, а не «мэтчей пока нет».
  private readonly allFailed = computed(
    () => this.failedCount() > 0 && this.visibleMatches().length === 0,
  );

  // Ошибка — при чтении моей анкеты, у живой подписки на мэтчи или у всех карточек сразу.
  protected readonly errorKey = computed(() => {
    const profileError = this.profileErrorKey();
    const subscriptionError = this.notifications.matchesError();
    if (profileError) {
      return profileError;
    }
    if (subscriptionError) {
      return firestoreErrorKey(subscriptionError);
    }
    if (this.allFailed() && !this.retrying()) {
      const entry = this.cards().get(this.failedUids()[0]);
      return firestoreErrorKey(entry?.state === 'error' ? entry.error : null);
    }
    return null;
  });

  // У каждого мэтча из живого списка уже есть запись в кэше (готова, удалена или ошибка).
  private readonly allSettled = computed(() => {
    const cards = this.cards();
    return this.notifications.matchList().every((match) => cards.has(match.otherUid));
  });

  // Скелетон: пока не пришли подписка, моя анкета или первая партия карточек.
  // И ещё при повторе после «не загрузилась ни одна» — чтобы было видно, что загрузка идёт.
  protected readonly loading = computed(
    () =>
      !this.notifications.matchesReady() ||
      this.myProfile() === undefined ||
      !this.firstBatchLoaded() ||
      (this.allFailed() && this.retrying()),
  );

  // Где сейчас фокус: uid карточки и сам элемент. Обычные поля, а не сигналы, — шаблон их не читает.
  private focusedUid: string | null = null;
  private focusedEl: HTMLElement | null = null;

  constructor() {
    // Открыл страницу — значит, новые мэтчи увидел: значок в меню гаснет.
    // Метод возвращает прошлую отметку — по ней ставим метки «Новый».
    this.seenBefore = this.notifications.markMatchesSeen();
    void this.loadMyProfile();

    // Пришёл новый снимок мэтчей — догружаем анкеты только новых людей, а ушедших забываем.
    effect(() => {
      const list = this.notifications.matchList();
      this.attempt(); // читаем только ради зависимости
      if (!this.notifications.matchesReady() || this.myProfile() === undefined) {
        return;
      }
      // untracked: сигналы, которые читает sync(), не должны перезапускать этот эффект.
      untracked(() => void this.sync(list));
    });

    // Защёлка первой партии. Сверяем с ТЕКУЩИМ живым списком, а не с тем, что был, когда
    // стартовал sync(): пока он грузил, мог прийти новый мэтч — и пустое состояние
    // «мэтчей пока нет» мигнуло бы на долю секунды.
    effect(() => {
      if (
        this.notifications.matchesReady() &&
        this.myProfile() !== undefined &&
        this.allSettled()
      ) {
        this.firstBatchLoaded.set(true);
      }
    });

    // afterRenderEffect срабатывает ПОСЛЕ того, как Angular обновил DOM: так видно настоящее
    // положение дел — какие карточки исчезли и где оказался фокус.
    afterRenderEffect(() => {
      const list = this.visibleMatches();
      untracked(() => this.keepFocus(list));
    });
  }

  // Кнопка «Попробовать ещё раз» на ошибке загрузки (страницы или отдельных карточек).
  protected retry(): void {
    if (this.retrying()) {
      return; // повтор уже идёт — второй клик ничего не добавит
    }
    this.profileErrorKey.set(null);
    if (this.notifications.matchesError()) {
      this.notifications.retryMatches();
    }
    if (this.myProfile() === undefined) {
      void this.loadMyProfile();
    }
    // Перезапрашиваем только упавшие карточки. Запись «ошибка» не стираем, пока не придёт
    // новый ответ: иначе строка с кнопкой исчезла бы прямо из-под фокуса.
    this.failedUids().forEach((uid) => this.requested.delete(uid));
    this.attempt.update((n) => n + 1);
  }

  // Мэтч разорван или человек заблокирован через «⋮» — убираем карточку и переносим фокус.
  //
  // Тонкость с порядком событий: removed приходит ПОСЛЕ того, как запись в Firestore завершилась,
  // а снимок onSnapshot со «своей» записью Firestore присылает раньше (сразу, из локального кэша).
  // Поэтому к этому моменту карточки в visibleMatches часто уже нет: раньше поиск соседа по нему
  // ничего не находил, и фокус улетал на h1. Теперь соседа ищем в order, где uid остаётся.
  protected remove(uid: string): void {
    // После закрытия окна подтверждения Material возвращает фокус на кнопку «⋮» этой карточки.
    // Элемент карточки берём ДО обновления сигнала — пока он точно в DOM (если ещё не исчез).
    const card = this.cardElement(uid);
    this.removedUids.update((removed) => new Set(removed).add(uid));
    const active = this.document.activeElement;
    const lost = !active || active === this.document.body;
    // Фокус «потерян» (карточка уже исчезла и унесла его) или всё ещё внутри уходящей карточки —
    // переносим на соседа. Если фокус уже в другом месте (его перенёс keepFocus() или человек
    // сам ушёл дальше) — не дёргаем.
    if (lost || card?.contains(active)) {
      this.forgetFocus();
      this.focusNeighbour(uid);
    }
  }

  // Фокус вошёл в карточку — запоминаем, в какую и на какой элемент.
  protected onFocusIn(event: FocusEvent, uid: string): void {
    this.focusedUid = uid;
    this.focusedEl = event.target instanceof HTMLElement ? event.target : null;
  }

  // Фокус ушёл из карточки. relatedTarget — элемент, куда он ушёл: если он вне карточки — забываем.
  // relatedTarget = null бывает в двух случаях: щёлкнули по пустому месту или элемент пропал
  // из DOM. Различаем их чуть позже (setTimeout): если элемент на месте, а фокус на body,
  // значит, щёлкнули мимо, и возвращать фокус в карточку нельзя.
  protected onFocusOut(event: FocusEvent, uid: string): void {
    const card = event.currentTarget as HTMLElement;
    const next = event.relatedTarget;
    if (next instanceof Node) {
      if (!card.contains(next) && this.focusedUid === uid) {
        this.forgetFocus();
      }
      return;
    }
    const element = event.target as HTMLElement;
    setTimeout(() => {
      if (
        this.focusedUid === uid &&
        element.isConnected &&
        this.document.activeElement === this.document.body
      ) {
        this.forgetFocus();
      }
    });
  }

  // Буфер обмена может быть недоступен (нет разрешения, старый браузер, не https) —
  // тогда честно говорим об этом, а не делаем вид, что скопировали.
  protected async copy(value: string, platform: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.snackBar.open(this.i18n.translate('matches.copiedNickname', { platform }), undefined, {
        duration: 2000,
      });
    } catch (error) {
      console.error(error);
      this.snackBar.open(this.i18n.translate('matches.copyFailed'), undefined, { duration: 4000 });
    }
  }

  // Карточка с фокусом исчезла сама (собеседник разорвал мэтч или заблокировал меня) или
  // переехала из-за сортировки. В обоих случаях браузер сбрасывает фокус на body, и тот,
  // кто ходит клавиатурой, теряется. Возвращаем фокус туда, где ему разумно быть.
  private keepFocus(list: MatchView[]): void {
    const uid = this.focusedUid;
    if (!uid) {
      return;
    }
    const active = this.document.activeElement;
    const lost = !active || active === this.document.body;
    if (list.some((match) => match.uid === uid)) {
      // Карточка на месте, но DOM вокруг неё перестроили — возвращаем фокус на тот же элемент.
      // preventScroll: с точки зрения человека фокус никуда не уходил, поэтому прокручивать
      // страницу незачем — иначе экран «уезжал» бы к карточке при каждом обновлении списка.
      if (lost && this.focusedEl?.isConnected) {
        this.focusedEl.focus({ preventScroll: true });
      }
      return;
    }
    // Карточка исчезла. Пока идёт анимация ухода, она ещё в DOM — и фокус может быть внутри.
    // Если же фокус уже в другом месте (например, его перенёс remove()), — не трогаем.
    const card = this.cardElement(uid);
    if (!lost && !card?.contains(active)) {
      this.forgetFocus();
      return;
    }
    this.forgetFocus();
    this.focusNeighbour(uid);
  }

  // Куда переносить фокус, когда карточка uid ушла: на имя следующей карточки, если её нет —
  // предыдущей, а если карточек не осталось — на заголовок страницы.
  // Иначе фокус «провалится» в начало страницы вместе с исчезнувшей карточкой.
  // Соседей ищем в order: там uid остаётся и после ухода карточки, так что её место известно.
  // «Следующая» — ближайшая ЕЩЁ ВИДИМАЯ после неё (соседняя могла исчезнуть одновременно).
  private focusNeighbour(uid: string): void {
    const order = this.order();
    const visible = new Map(this.visibleMatches().map((match) => [match.uid, match]));
    visible.delete(uid); // на случай, если снимок ещё не догнал и карточка числится видимой
    const index = order.indexOf(uid);
    const next = index < 0 ? undefined : order.slice(index + 1).find((other) => visible.has(other));
    // reverse() на копии от slice — исходный order не трогаем (findLast недоступен в ES2022).
    const prev =
      index < 0
        ? undefined
        : order
            .slice(0, index)
            .reverse()
            .find((other) => visible.has(other));
    const target = visible.get(next ?? prev ?? '');
    // Заголовок соседней карточки и h1 уже есть в DOM, поэтому фокус можно ставить сразу.
    // Прокрутку здесь НЕ запрещаем: фокус переезжает на другую карточку, её нужно увидеть.
    const id = target ? target.headingId : 'matches-title';
    this.host.nativeElement.querySelector<HTMLElement>(`#${id}`)?.focus();
  }

  // DOM-элемент карточки по uid (пока карточка «тает» после ухода, она ещё здесь).
  private cardElement(uid: string): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(`article[data-uid="${uid}"]`);
  }

  private forgetFocus(): void {
    this.focusedUid = null;
    this.focusedEl = null;
  }

  private async loadMyProfile(): Promise<void> {
    try {
      const { profile } = await this.profiles.load(this.me);
      this.myProfile.set(profile);
    } catch (error) {
      this.profileErrorKey.set(firestoreErrorKey(error));
    }
  }

  private async sync(list: LiveMatch[]): Promise<void> {
    const current = new Set(list.map((match) => match.otherUid));
    // Мэтча больше нет — забываем и карточку, и пометку «убрана»: если мэтч появится снова,
    // контакты нужно перечитать (без мэтча правила их не отдают).
    const gone = [...this.requested].filter((uid) => !current.has(uid));
    if (gone.length) {
      gone.forEach((uid) => this.requested.delete(uid));
      this.cards.update((cards) => new Map([...cards].filter(([uid]) => current.has(uid))));
      this.removedUids.update((removed) => new Set([...removed].filter((uid) => current.has(uid))));
    }

    const fresh = list.filter((match) => !this.requested.has(match.otherUid));
    fresh.forEach((match) => this.requested.add(match.otherUid));
    this.setInFlight(fresh, true);
    // Анкеты и контакты новых мэтчей — параллельно. Контакты нам отдают, потому что мэтч есть
    // (см. firestore.rules). Одна упавшая карточка не ломает всю страницу: она попадает в кэш
    // как «ошибка», и её можно перезапросить кнопкой.
    await Promise.all(
      fresh.map(async (match) => {
        let entry: CardEntry;
        try {
          const { profile, contacts } = await this.profiles.load(match.otherUid);
          const view = this.toView(match, profile, contacts);
          entry = view ? { state: 'view', view } : { state: 'deleted' };
        } catch (error) {
          console.error(error);
          entry = { state: 'error', error };
        }
        this.setInFlight([match], false);
        // Пока грузили, мэтч могли разорвать — тогда результат уже не нужен.
        if (this.requested.has(match.otherUid)) {
          this.cards.update((cards) => new Map(cards).set(match.otherUid, entry));
        }
      }),
    );
  }

  // Отмечаем, что запросы за этими uid ушли (on) или вернулись (off).
  private setInFlight(matches: LiveMatch[], on: boolean): void {
    if (!matches.length) {
      return;
    }
    this.inFlight.update((set) => {
      const next = new Set(set);
      matches.forEach((match) => (on ? next.add(match.otherUid) : next.delete(match.otherUid)));
      return next;
    });
  }

  private toView(
    match: LiveMatch,
    profile: UserProfile | null,
    contacts: UserContacts | null,
  ): MatchView | null {
    // Человек удалил анкету — мэтч не показываем.
    if (!profile) {
      return null;
    }
    const myProfile = this.myProfile();
    return {
      id: match.id,
      uid: match.otherUid,
      headingId: `match-name-${match.id}`,
      profile,
      age: ageFrom(profile.birthDate),
      commonGames: myProfile ? matchScore(myProfile, profile).commonGames : [],
      contacts: this.toContactList(contacts),
    };
  }

  // Только заполненные контакты. Ссылкой считаем лишь проверенную ссылку на сайт платформы —
  // всё остальное показываем как обычный текст (ник), даже если там что-то похожее на адрес.
  private toContactList(contacts: UserContacts | null): MatchView['contacts'] {
    return CONTACT_FIELDS.flatMap((field) => {
      const value = contacts?.[field]?.trim() ?? '';
      return value
        ? [{ field, value, isLink: isProfileLink(value, CONTACT_SITES[field].domains) }]
        : [];
    });
  }
}
