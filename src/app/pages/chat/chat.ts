import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/auth/auth';
import { FirebaseError } from 'firebase/app';
import { ChatMessage, ChatService, MAX_MESSAGE_LENGTH } from '../../core/chat/chat';
import { ChatDrafts } from '../../core/chat/chat-drafts';
import {
  firestoreErrorKey,
  isNetworkErrorKey,
  isPermissionDenied,
} from '../../core/firebase/firestore-errors';
import { I18n } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { matchScore } from '../../core/matching/match-score';
import { NotificationService } from '../../core/notifications/notifications';
import { ProfileService } from '../../core/profile/profile';
import {
  ageFrom,
  gameKey,
  inCatalogOrder,
  Platform,
  PLATFORMS,
  PLAY_TIMES,
  PlayTime,
  UserContacts,
  UserProfile,
} from '../../core/profile/profile.model';
import { ContactChips } from '../../shared/contact-chips/contact-chips';
import { initialOf } from '../../shared/initial';
import { ErrorState } from '../../shared/error-state/error-state';
import { ModerationMenu } from '../../shared/moderation-menu/moderation-menu';
import { StateMessage } from '../../shared/state-message/state-message';

// notFound — мэтча нет или он чужой; error — не загрузилось (например, нет сети), можно повторить.
// ended — чат был открыт, но мэтч пропал прямо во время разговора (собеседник разорвал мэтч
// или заблокировал). Переписку оставляем на экране «замороженной», а писать уже нельзя.
type ChatState = 'loading' | 'ready' | 'ended' | 'notFound' | 'error';

// Одна «порция» озвучки для живой области. key — id последнего озвучиваемого сообщения:
// шаблон рисует порцию через @for с track по key, поэтому каждая новая порция — это НОВЫЙ
// элемент в DOM. Программа чтения с экрана замечает вставку и читает её, даже если текст
// дословно совпадает с прошлым («ок», «ок») — простая замена одинакового текста была бы «тишиной».
interface Announcement {
  key: string;
  lines: string[];
}

// Сколько ждём перехода на /matches после своего «Разорвать мэтч»/«Заблокировать».
// Если за это время перехода не было — действие, видимо, не удалось (ошибку покажет само меню),
// и чат снова должен реагировать на настоящее завершение.
const LEAVING_TIMEOUT_MS = 15000;

// «Почти внизу» — до низа списка осталось меньше этого (в пикселях). Ровно 0 требовать нельзя:
// поле ввода, вырастая на строку, чуть сдвигает низ, и человек «внизу» оказался бы «не внизу».
const NEAR_BOTTOM_PX = 80;

// «Тема для разговора» над полем ввода видна, пока переписка только начинается:
// всего сообщений меньше STARTER_MAX, или их меньше STARTER_MAX_MY_TURN и последнее — от собеседника
// (мой ход отвечать, а о чём — подскажут общие игры). Дальше разговор идёт сам, и строка исчезает.
const STARTER_MAX = 3;
const STARTER_MAX_MY_TURN = 6;
// Сколько общих игр показывать в этой строке: она должна оставаться короткой и не съедать переписку.
const STARTER_GAMES = 4;

// Название вкладки, когда открыта не страница чата (в index.html то же самое).
const DEFAULT_TITLE = 'DeadIsland';

// Сообщения одного человека, отправленные с паузой не больше 5 минут, — одна «серия» (группа).
const GROUP_GAP_MS = 5 * 60 * 1000;

// Один и тот же календарный день (по местному времени устройства, а не по UTC:
// «вчера» должно значить «вчера» для человека, а не для Гринвича).
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Насколько старо приглашение: «сегодня вечером» из вчерашнего сообщения — уже не план.
// Только что отправленное (без времени сервера) — свежее.
function inviteAge(createdAt: Date | null): 'fresh' | 'yesterday' | 'old' {
  if (!createdAt) {
    return 'fresh';
  }
  const now = new Date();
  if (sameDay(createdAt, now)) {
    return 'fresh';
  }
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return sameDay(createdAt, yesterday) ? 'yesterday' : 'old';
}

// «2026-10-28» — день по местному календарю для атрибута datetime у <time>.
function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Делает функцию «дата → подпись разделителя дней» на нужном языке.
// «Сегодня» и «Вчера» даёт сам браузер: Intl.RelativeTimeFormat с numeric: 'auto' превращает
// «−1 день» в слово «вчера» на любом языке — отдельные переводы не нужны. Только пишет он их
// со строчной буквы («вчера», «today»), а подпись стоит отдельно — поднимаем первую букву.
// Остальные дни — полной датой без года («12 октября»), а для прошлых лет — с годом.
function dayLabeller(lang: string): (date: Date) => string {
  const relative = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const thisYear = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long' });
  const otherYear = new Intl.DateTimeFormat(lang, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase(lang) + text.slice(1);
  return (date) => {
    const now = new Date();
    // Сколько календарных дней назад: сравниваем полночи, а не разницу в часах
    // (вчера в 23:50 — это «вчера», хотя прошло всего 20 минут).
    const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const daysAgo = Math.round((midnight(now) - midnight(date)) / (24 * 60 * 60 * 1000));
    if (daysAgo === 0 || daysAgo === 1) {
      return capitalize(relative.format(-daysAgo, 'day'));
    }
    return (date.getFullYear() === now.getFullYear() ? thisYear : otherYear).format(date);
  };
}

// Моё сообщение, которое сервер ОТКЛОНИЛ (правила, ошибка записи). Firestore в этом случае
// сам убирает его из списка (откатывает локальную запись), поэтому храним его отдельно —
// чтобы человек видел, что именно не ушло, и мог отправить ещё раз одной кнопкой.
// Без сети запись не отклоняется, а просто ждёт: такое сообщение остаётся в списке с «часиками».
interface FailedMessage {
  id: string;
  text: string;
}

@Component({
  selector: 'app-chat',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TextFieldModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
    TranslatePipe,
    ModerationMenu,
    ContactChips,
    ErrorState,
    StateMessage,
  ],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
})
export class Chat {
  private readonly auth = inject(AuthService);
  private readonly chat = inject(ChatService);
  private readonly drafts = inject(ChatDrafts);
  private readonly profiles = inject(ProfileService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18n);
  private readonly router = inject(Router);
  // Title — сервис Angular для заголовка вкладки браузера (<title> в <head>).
  private readonly title = inject(Title);

  // id мэтча из адреса /chat/:matchId. Роутер сам кладёт параметр в input (withComponentInputBinding).
  // Если из одного чата перейти в другой, Angular переиспользует компонент и просто меняет input —
  // поэтому всё, что зависит от matchId, делаем в effect, а не один раз в конструкторе.
  readonly matchId = input.required<string>();
  // ?play=1 — пришли из карточки нового мэтча по «Позвать в …»: приглашение сразу лежит в поле ввода.
  readonly play = input<string>();

  // Страница закрыта authGuard, поэтому пользователь здесь всегда есть.
  private readonly me = this.auth.user()!.uid;

  protected readonly maxLength = MAX_MESSAGE_LENGTH;
  // Счётчик «850 / 1000» под полем появляется только у длинных сообщений: в обычной
  // переписке он был бы лишним шумом. Обрезать текст молча (атрибутом maxlength) мы больше
  // не даём: вставленный длинный текст остаётся целиком, счётчик краснеет, а кнопка
  // «Отправить» выключается, пока сообщение не станет короче, — человек видит, что не так.
  protected readonly counterFrom = 800;
  protected readonly state = signal<ChatState>('loading');
  protected readonly errorKey = signal('errors.unknown');
  // Пузыри-заготовки для скелетона: чьё сообщение и какой ширины (в %).
  protected readonly skeletonBubbles = [
    { mine: false, width: 55 },
    { mine: true, width: 40 },
    { mine: false, width: 70 },
    { mine: true, width: 50 },
  ];
  protected readonly partner = signal<UserProfile | null>(null);
  protected readonly partnerUid = signal<string | null>(null);
  // Когда собеседник последний раз открывал этот чат (мс, 0 — ни разу). Всё моё, что написано
  // до этого момента, он видел — у таких сообщений двойная галочка «Прочитано».
  private readonly partnerReadAt = signal(0);
  protected readonly commonGames = signal<string[]>([]);
  // Общее время игры (утром, вечером, на выходных…) — второй повод для разговора.
  protected readonly commonPlayTimes = signal<PlayTime[]>([]);
  // Общие платформы — на чём можно сыграть вместе (первая из них попадает в приглашение).
  private readonly commonPlatforms = signal<Platform[]>([]);
  // Контакты собеседника (Discord, Steam, PSN, Xbox) — для карточки игрока. Правила базы отдают
  // их только при взаимном мэтче; не загрузились — карточка просто скажет, что контактов нет.
  protected readonly partnerContacts = signal<UserContacts | null>(null);
  // Раскрыта ли карточка игрока под шапкой (кнопка — имя собеседника).
  protected readonly partnerOpen = signal(false);
  private readonly messages = signal<ChatMessage[]>([]);
  // Идёт ли сейчас отправка — пока да, второй Enter/нажатие кнопки ничего не делает (см. send).
  // Кнопку по нему НЕ выключаем: выключенная кнопка теряет фокус, и на телефоне закрывается клавиатура.
  private readonly sending = signal(false);
  // Сенсорный ли экран — запоминаем при открытии, чтобы решить, показывать ли подсказку про Enter.
  protected readonly touch = this.isTouch();
  // Озвучка для программы чтения с экрана: новые ВХОДЯЩИЕ сообщения («Аня: привет»).
  // Свои сообщения не озвучиваем — человек их только что сам набрал.
  // Массив из 0 или 1 элемента — так шаблон может пересоздать элемент по key (см. Announcement).
  protected readonly announcement = signal<Announcement[]>([]);
  // Неотправленные сообщения (см. FailedMessage) — рисуются в конце переписки с кнопкой «Повторить».
  protected readonly failed = signal<FailedMessage[]>([]);
  // Плашка «Новые сообщения ↓»: пришло входящее, а человек в этот момент листал историю выше.
  // Прокручивать его вниз силой нельзя — он потеряет место, где читал.
  protected readonly newBelow = signal(false);

  // Есть ли у браузера сеть. Обновляется событиями online/offline на window (подписка в конструкторе).
  // navigator.onLine === false — надёжный признак «сети точно нет»; true бывает и при «плохой» сети,
  // но для подсказки ниже нам важен именно явный офлайн.
  private readonly online = signal(typeof navigator === 'undefined' || navigator.onLine);

  // Имя собеседника для подписей; если анкета не загрузилась — нейтральное «Игрок».
  protected readonly partnerName = computed(
    () => this.partner()?.name || this.i18n.translate('chat.unknown'),
  );
  // Монограмма в шапке, если у собеседника нет фото (см. shared/initial.ts).
  protected readonly partnerInitial = computed(() =>
    initialOf(this.partnerName(), this.i18n.lang()),
  );

  // Сообщения в том виде, в каком их рисует шаблон. Время — в формате выбранного языка сайта.
  // Кроме текста и времени, каждому сообщению заранее считаем две вещи для вёрстки:
  // - day: подпись разделителя «Сегодня» / «Вчера» / «12 октября», если с этого сообщения
  //   начинается новый календарный день (иначе null — разделителя нет);
  // - groupStart / groupEnd: сообщение начинает / завершает «серию» — подряд от одного
  //   человека с паузами не больше GROUP_GAP_MS. Внутри серии пузыри стоят плотнее,
  //   а «хвостик» (острый угол) есть только у последнего — как в привычных мессенджерах.
  protected readonly messageViews = computed(() => {
    const lang = this.i18n.lang();
    const format = new Intl.DateTimeFormat(lang, {
      hour: '2-digit',
      minute: '2-digit',
    });
    // Форматтеры создаём один раз на весь пересчёт, а не на каждое сообщение: это недёшево.
    const dayLabel = dayLabeller(lang);
    const list = this.messages();
    // У сообщения без времени (бывает у только что отправленного, пока нет оценки сервера)
    // считаем время «сейчас» — оно и правда только что появилось.
    const at = (m: ChatMessage) => m.createdAt ?? new Date();
    return list.map((message, i) => {
      const prev = list[i - 1];
      const next = list[i + 1];
      const time = at(message);
      const newDay = !prev || !sameDay(at(prev), time);
      // С соседом в одной серии: тот же отправитель, тот же день и пауза не больше 5 минут.
      const joined = (a: ChatMessage, b: ChatMessage) =>
        a.from === b.from &&
        sameDay(at(a), at(b)) &&
        Math.abs(at(b).getTime() - at(a).getTime()) <= GROUP_GAP_MS;
      return {
        id: message.id,
        text: message.text,
        mine: message.from === this.me,
        time: message.createdAt ? format.format(message.createdAt) : '',
        // Машиночитаемое время для <time datetime="...">: ISO-строка вида 2026-10-28T18:05:00.000Z.
        datetime: message.createdAt?.toISOString() ?? null,
        // Состояние доставки показываем только у своих: «часики» — ждём сервер, галочка — записано,
        // двойная галочка — собеседник открыл чат после этого сообщения.
        pending: message.pending,
        read:
          !message.pending &&
          !!message.createdAt &&
          message.createdAt.getTime() <= this.partnerReadAt(),
        day: newDay ? dayLabel(time) : null,
        // Дата дня для <time datetime> в разделителе: «2026-10-28» (по местному календарю).
        dayIso: newDay ? isoDay(time) : null,
        groupStart: !prev || !joined(prev, message),
        groupEnd: !next || !joined(message, next),
        // Приглашение поиграть рисуем карточкой-пузырём, а не обычным сообщением.
        invite: message.invite,
        // Вчерашнее и более старое приглашение — уже не план: другая подпись, без «Я в деле».
        inviteAge: message.invite ? inviteAge(message.createdAt) : null,
      };
    });
  });

  // Строка «Тема для разговора» над полем ввода (см. STARTER_MAX). В пустом чате она не нужна:
  // там те же общие игры уже показывает приветствие посреди списка. После моего приглашения — тоже.
  protected readonly starter = computed(() => {
    const list = this.messages();
    const games = this.commonGames().slice(0, STARTER_GAMES);
    const times = this.commonPlayTimes();
    if (this.state() !== 'ready' || !list.length || (!games.length && !times.length)) {
      return null;
    }
    // Я уже позвал(а) играть — тема найдена, подсказка своё отработала.
    if (this.inviteSent()) {
      return null;
    }
    const myTurn = list.at(-1)!.from !== this.me;
    const early = list.length < STARTER_MAX || (myTurn && list.length < STARTER_MAX_MY_TURN);
    return early ? { games, times } : null;
  });

  // Карточка игрока под шапкой чата: всё, что нужно, чтобы договориться о совместной игре, не уходя
  // из переписки. Общее (cyan) идёт первым — ради него и случился мэтч, остальное — тише следом.
  protected readonly partnerCard = computed(() => {
    const partner = this.partner();
    if (!partner) {
      return null;
    }
    // Внутри «общего» и «остального» — порядок каталога (catalog), как на странице мэтчей.
    const sharedFirst = <T>(items: T[], shared: T[], catalog: readonly T[]) => {
      const all = inCatalogOrder(items, catalog);
      const common = new Set(shared);
      return [
        ...all.filter((item) => common.has(item)).map((item) => ({ item, shared: true })),
        ...all.filter((item) => !common.has(item)).map((item) => ({ item, shared: false })),
      ];
    };
    // Общие игры matchScore отдаёт в МОЁМ написании («valorant»), а у собеседника может быть
    // «Valorant» или «CS2» вместо «Counter-Strike 2» — поэтому сравниваем по ключу из каталога (gameKey).
    const commonGames = new Set(this.commonGames().map(gameKey));
    const games = partner.games.map((game) => ({
      item: game,
      shared: commonGames.has(gameKey(game)),
    }));
    return {
      age: partner.birthDate ? ageFrom(partner.birthDate) : null,
      city: partner.city,
      photo: partner.photo,
      bio: partner.bio.trim(),
      games: [...games.filter((g) => g.shared), ...games.filter((g) => !g.shared)],
      platforms: sharedFirst(partner.platforms, this.commonPlatforms(), PLATFORMS),
      times: sharedFirst(partner.playTimes, this.commonPlayTimes(), PLAY_TIMES),
    };
  });

  // Подсказка над полем ввода «Отправим, когда появится сеть»: показываем, только когда есть мои
  // сообщения с «часиками» И браузер точно офлайн. Одни «часики» мелкие и ничего не обещают —
  // человек мог решить, что сообщения потерялись. А при живой сети «часики» висят доли секунды,
  // и мигающая строка только отвлекала бы.
  protected readonly queuedOffline = computed(
    () => !this.online() && this.messageViews().some((m) => m.mine && m.pending),
  );

  protected readonly draft = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(MAX_MESSAGE_LENGTH)],
  });

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('input');
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly partnerToggle = viewChild<ElementRef<HTMLButtonElement>>('partnerToggle');
  // Для какого чата уже поставили фокус при открытии — чтобы не перехватывать его снова
  // на каждом новом сообщении (см. afterRenderEffect «фокус при открытии»).
  private focusedFor: string | null = null;
  private markReadFailed = false;
  // id сообщений, которые уже были на экране, — чтобы озвучивать только действительно новые.
  // null — «точки отсчёта» ещё нет (историю при открытии чата не зачитываем).
  private seenIds: Set<string> | null = null;
  // Время самого нового из уже виденных сообщений. Подстраховка к seenIds: если сервер дослал
  // СТАРЫЕ сообщения, которых не было в кэше, они не новые — их не озвучиваем.
  private seenUntil = 0;
  // Чат, для которого сейчас всё настроено: по нему effect понимает, что сменился именно мэтч,
  // а не просто нажали «Попробовать ещё раз».
  private loadedMatchId: string | null = null;
  // Я сам разрываю мэтч или блокирую собеседника: исчезновение мэтча — ожидаемое следствие,
  // показывать «Чат завершён» (и озвучивать это) не нужно — сейчас уйдём на /matches.
  private leaving = false;
  private leavingTimer: ReturnType<typeof setTimeout> | undefined;
  // Пока я «ухожу», признаки завершения глушим. Если уход не удался — их надо перепроверить.
  private endSuppressed = false;
  // Идёт ли проверка «а мэтч точно удалён?» и какой снимок переписки применить, если нет.
  private verifying = false;
  private pendingMessages: ChatMessage[] | null = null;
  // «Спробувати ще раз» увеличивает счётчик — effect ниже читает его и запускается заново.
  private readonly attempt = signal(0);
  // Для прокрутки: какой элемент списка мы уже прокрутили (новый элемент = чат только что открылся),
  // какое сообщение было последним и сколько было неотправленных — так afterRenderEffect понимает,
  // что именно изменилось: пришло новое сообщение или у старого просто сменились «часики» на галочку.
  private scrolledList: HTMLElement | null = null;
  private lastTailId: string | null = null;
  private lastFailedCount = 0;
  // Был ли человек внизу списка ДО того, как пришло новое сообщение. Обновляется на каждой
  // прокрутке (onScroll): после отрисовки нового пузыря «до низа» уже больше, и мерить поздно.
  private nearBottom = true;
  private failedSeq = 0;

  constructor() {
    effect((onCleanup) => {
      const matchId = this.matchId();
      this.attempt();
      // Эффект должен перезапускаться ТОЛЬКО от matchId и attempt (две строки выше). Всё остальное —
      // в untracked: иначе любое прочитанное здесь значение сигнала тоже стало бы «зависимостью».
      // Так и было: drafts.get() читает сигнал черновиков, первый же набранный символ сохранял
      // черновик — и эффект перезапускал весь чат (скелетон, потеря фокуса и набранного текста).
      untracked(() => {
        // Перешли в ДРУГОЙ чат (компонент тот же): всё, что относилось к прошлому собеседнику,
        // стираем — иначе недописанный текст «утёк» бы в чужую переписку, а в шапке мелькнуло бы
        // старое имя. При повторе того же чата черновик, наоборот, сохраняем.
        if (matchId !== this.loadedMatchId) {
          this.loadedMatchId = matchId;
          // Черновик — свой у каждого чата (см. ChatDrafts): достаём текст, недописанный именно
          // этому собеседнику, или пустую строку. emitEvent: false — это не ввод человека, и
          // подписка valueChanges ниже не должна записывать его обратно.
          this.draft.reset(this.drafts.get(matchId), { emitEvent: false });
          this.draftText.set(this.draft.value);
          this.partner.set(null);
          this.commonGames.set([]);
          this.commonPlayTimes.set([]);
          this.commonPlatforms.set([]);
          this.partnerContacts.set(null);
          this.partnerOpen.set(false);
          this.focusedFor = null;
          // Неотправленные сообщения относятся к тому чату, где их писали.
          this.failed.set([]);
          this.stopLeaving();
        }
        this.state.set('loading');
        this.messages.set([]);
        this.partnerUid.set(null);
        this.partnerReadAt.set(0);
        this.markReadFailed = false;
        this.seenIds = null;
        this.seenUntil = 0;
        this.announcement.set([]);
        this.sending.set(false);
        this.verifying = false;
        this.pendingMessages = null;
        this.endSuppressed = false;
        this.newBelow.set(false);
        // Прокрутку отдельно сбрасывать не нужно: в состоянии loading список удаляется из DOM,
        // а новый после загрузки сам прокручивается в самый низ (afterRenderEffect ниже узнаёт
        // его как «новый элемент»).
        this.notifications.activeChat.set(matchId);

        void this.loadPartner(matchId);
        // Подписка на сообщения: новые приходят сами, пока страница открыта.
        const unsubscribe = this.chat.watchMessages(
          matchId,
          (messages, fromCache) => this.onMessages(matchId, messages, fromCache),
          (error) => this.fail(matchId, error),
        );
        // Подписка на сам мэтч: если собеседник разорвёт его посреди разговора, узнаем сразу.
        const unsubscribeMatch = this.chat.watchMatch(
          matchId,
          this.me,
          () => this.end(),
          // Ошибка доступа обычно значит «мэтч удалён», но проверяем это отдельным запросом.
          (error) => (isPermissionDenied(error) ? this.verifyEnded(matchId) : console.error(error)),
          (at) => this.partnerReadAt.set(at),
        );
        onCleanup(() => {
          unsubscribe();
          unsubscribeMatch();
          this.notifications.activeChat.set(null);
        });
      });
    });

    // Пока чат открыт, всё пришедшее сразу прочитано: значок непрочитанного гаснет
    // и у меня, и в превью на странице «Мэтчи». Ошибку не повторяем, чтобы не зациклиться.
    effect(() => {
      const matchId = this.matchId();
      if (
        this.state() === 'ready' &&
        this.notifications.unreadChats().has(matchId) &&
        !this.markReadFailed
      ) {
        this.chat.markRead(matchId, this.me).catch((error) => {
          this.markReadFailed = true;
          console.error(error);
        });
      }
    });

    // afterRenderEffect срабатывает ПОСЛЕ того, как Angular нарисовал новые сообщения, —
    // тогда высота списка уже новая, и можно решать, прокручивать ли его вниз.
    afterRenderEffect(() => {
      const views = this.messageViews();
      const failedCount = this.failed().length;
      const list = this.list()?.nativeElement;
      if (!list) {
        this.scrolledList = null;
        return;
      }
      const tail = views.at(-1);
      const tailId = tail?.id ?? null;
      const opened = list !== this.scrolledList;
      const newTail = tailId !== this.lastTailId;
      const newFailed = failedCount > this.lastFailedCount;
      this.scrolledList = list;
      this.lastTailId = tailId;
      this.lastFailedCount = failedCount;

      // Вниз прокручиваем, если: чат только что открылся; новое сообщение — моё (я его только что
      // отправил и хочу видеть) или моё не ушло; человек и так был внизу. Последнее касается и
      // снимков без новых сообщений (часики → галочка): высота пузыря могла чуть измениться.
      if (opened || (newTail && tail?.mine) || newFailed || this.nearBottom) {
        list.scrollTop = list.scrollHeight;
        this.nearBottom = true;
        this.newBelow.set(false);
      } else if (newTail && tail) {
        // Человек читает историю выше — не дёргаем его, а показываем плашку «Новые сообщения».
        this.newBelow.set(true);
      }
    });

    // Заголовок вкладки: «Аня · Чат — DeadIsland». Так открытый чат видно в списке вкладок,
    // в истории браузера, и программа чтения с экрана называет страницу при переходе.
    // effect сам обновит его, когда загрузится имя или человек сменит язык.
    effect(() => {
      const name = this.partner()?.name;
      this.title.setTitle(name ? this.i18n.translate('chat.docTitle', { name }) : DEFAULT_TITLE);
    });

    // Пришли по «Позвать в …» из карточки нового мэтча (?play=1): как только известна карточка
    // собеседника (из неё собирается текст), кладём приглашение в поле — один раз — и убираем
    // параметр из адреса, чтобы перезагрузка или «назад» не повторяли это. Не отправляем сами.
    // Уже звали играть — ничего не кладём, просто чистим адрес.
    afterRenderEffect(() => {
      if (!this.play() || this.state() !== 'ready' || !this.partnerCard() || !this.input()) {
        return;
      }
      untracked(() => {
        // На сенсорном экране фокус в поле открыл бы клавиатуру, и она закрыла бы пустой чат
        // с общими играми. Черновик просто лежит в поле, а пустой чат говорит, что он там.
        if (!this.inviteSent()) {
          this.inviteToPlay(!this.touch);
        }
        void this.router.navigate([], {
          queryParams: { play: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      });
    });

    // Фокус при открытии чата. Без него он оставался на <body>: клавиатурный пользователь
    // начинал «с нуля», а программа чтения с экрана не понимала, что страница сменилась.
    // - мышь/тачпад (pointer: fine) — сразу в поле ввода: открыл чат — можно печатать;
    // - сенсорный экран — на заголовок с именем: фокус в поле ввода открыл бы клавиатуру
    //   и закрыл ею половину переписки.
    // Только один раз на чат (focusedFor) и только если фокус никто не занял (он на <body>):
    // если человек уже успел нажать что-то сам, не выдёргиваем его оттуда.
    afterRenderEffect(() => {
      const ready = this.state() === 'ready';
      const target = this.touch ? this.heading() : this.input();
      const matchId = this.matchId();
      if (!ready || !target || this.focusedFor === matchId) {
        return;
      }
      this.focusedFor = matchId;
      const active = document.activeElement;
      if (!active || active === document.body) {
        // focusVisible: false — браузер не рисует рамку фокуса: её место — когда человек сам
        // пришёл сюда клавишей. Без этой опции Chrome показывает рамку на заголовке, если страницу
        // открыли «с нуля» (по ссылке или перезагрузкой) и ещё ни разу не касались её.
        // FocusOptions в типах TypeScript пока без этого поля, поэтому — через приведение типа.
        target.nativeElement.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
      }
    });

    // Каждое изменение поля ввода сразу кладём в черновик ЭТОГО чата: уйдёт человек со страницы
    // (назад, по уведомлению, перезагрузит вкладку) — текст дождётся его возвращения.
    // После отправки send() очищает поле, и пустая строка стирает черновик.
    // takeUntilDestroyed — подписка сама закончится вместе со страницей.
    this.draft.valueChanges.pipe(takeUntilDestroyed()).subscribe((text) => {
      this.draftText.set(text ?? '');
      if (this.loadedMatchId) {
        this.drafts.set(this.loadedMatchId, text);
      }
    });

    // Сеть пропала / появилась — обновляем сигнал online (от него зависит подсказка queuedOffline).
    const updateOnline = () => this.online.set(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    // Таймер «ухода» не должен сработать, когда страницы уже нет; слушатели сети — тоже снимаем.
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.leavingTimer);
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      // Другие страницы свой заголовок не ставят — возвращаем общий, иначе имя собеседника
      // осталось бы во вкладке и на ленте, и в профиле.
      this.title.setTitle(DEFAULT_TITLE);
    });
  }

  protected send(): void {
    const text = this.draft.value.trim();
    if (!text || this.draft.invalid || this.sending() || this.state() !== 'ready') {
      return;
    }
    // Поле очищаем сразу (а с ним и черновик этого чата — см. подписку valueChanges), не дожидаясь сервера: Firestore и так мгновенно покажет сообщение
    // в списке (из локального кэша) — с «часиками», пока сервер его не подтвердит.
    // sending снимается, как только сообщение появилось в списке (см. applyMessages) или запись
    // завершилась. Ждать только ответа сервера нельзя: без сети он не придёт никогда,
    // и человек не смог бы отправить второе сообщение офлайн.
    this.sending.set(true);
    this.draft.reset();
    // Фокус остаётся в поле ввода: на телефоне клавиатура не закрывается, можно писать дальше.
    this.input()?.nativeElement.focus();
    void this.deliver(this.matchId(), text);
  }

  // Кнопка-имя в шапке раскрывает и прячет карточку игрока.
  protected togglePartner(): void {
    this.partnerOpen.update((open) => !open);
  }

  // Esc или «Закрыть» в карточке: прячем её и возвращаем фокус на кнопку-имя, откуда её открыли, —
  // иначе фокус «упал» бы на <body> вместе с исчезнувшей кнопкой.
  protected closePartner(): void {
    this.partnerOpen.set(false);
    this.partnerToggle()?.nativeElement.focus();
  }

  // Текст приглашения «Сыграем в Valorant сегодня вечером? Я на PC.» — из первой общей
  // игры, платформы и времени В ТОМ ЖЕ ПОРЯДКЕ, что в карточке игрока (порядок и написание
  // собеседника): иначе карточка показывала бы первой PlayStation, а приглашение говорило «Я на PC».
  // Общего нет — нейтральное «Сыграем во что-нибудь вместе?».
  protected readonly invite = computed(() => {
    const card = this.partnerCard();
    const game = card?.games.find((g) => g.shared)?.item;
    const platform = card?.platforms.find((p) => p.shared)?.item;
    const time = card?.times.find((t) => t.shared)?.item;
    // Время вплетаем в первую фразу («…сегодня вечером?»), а не отдельной строкой «Мне удобно: вечером.» —
    // так приглашение звучит как живая реплика, а не анкета.
    // Первая фраза отдельно: по ней узнаём уже отправленное приглашение (см. inviteSent).
    const when = time ? this.i18n.translate(`chat.invite.when.${time}`) : '';
    const opener = game
      ? this.i18n.translate(when ? 'chat.invite.gameWhen' : 'chat.invite.game', { game, when })
      : this.i18n.translate(when ? 'chat.invite.anyWhen' : 'chat.invite.any', { when });
    const parts = [opener];
    if (platform) {
      parts.push(
        this.i18n.translate('chat.invite.platform', {
          platform: this.i18n.translate(`catalog.platforms.${platform}`),
        }),
      );
    }
    return { opener, text: parts.join(' ') };
  });

  // Играть уже звали — я или собеседник: в переписке есть сообщение с меткой «приглашение»
  // (kind: 'invite', ставится при отправке, см. deliver). Метка не зависит от языка интерфейса:
  // приглашение, отправленное по-русски, узнаётся и в украинском интерфейсе. Для старых сообщений
  // без метки — запасная проверка по первой фразе (только моей и только на текущем языке).
  // Тогда строка темы и тихие кнопки «Позвать играть» прячутся: интерфейс не предлагает
  // позвать ещё раз. Кнопка в карточке игрока остаётся: туда заходят осознанно.
  protected readonly inviteSent = computed(() => {
    const opener = this.invite().opener;
    return this.messages().some((m) => m.invite || (m.from === this.me && m.text.includes(opener)));
  });

  // «Позвать играть»: кладём приглашение в поле ввода. Не отправляем сами: человек допишет
  // или поправит и отправит, когда захочет. Уже набранный текст не стираем — приглашение встаёт
  // после него. Если оно уже есть в поле (второе нажатие) — не дублируем, только ставим фокус.
  // focus: false — только положить текст, не трогая фокус (переход из «Позвать в …» на телефоне).
  protected inviteToPlay(focus = true): void {
    const invite = this.invite().text;
    const current = this.draft.value.trimEnd();
    if (!current.includes(invite)) {
      // setValue (а не reset) — это правка черновика, её подхватит подписка и сохранит в ChatDrafts.
      this.draft.setValue(current ? `${current} ${invite}` : invite);
    }
    this.partnerOpen.set(false);
    // Фокус — в поле с курсором в конце: остаётся нажать «Отправить» или дописать.
    const field = this.input()?.nativeElement;
    if (field && focus) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
  }

  // Текст поля ввода сигналом: по нему пустой чат узнаёт, что приглашение уже лежит в поле.
  private readonly draftText = signal('');
  // Приглашение уже в поле (пришли по «Позвать в …» или нажали кнопку): кнопка «Позвать играть»
  // и строка «Положит в поле: …» больше ничего не сделают — вместо них короткое «оно уже в поле».
  protected readonly inviteDrafted = computed(() => this.draftText().includes(this.invite().text));

  // Приглашение от собеседника, на которое я ещё ничего не ответил: под ним — кнопка «Я в деле!».
  // Как только я написал что угодно после него, кнопка пропадает: ответ уже есть.
  protected readonly openInviteId = computed(() => {
    // Идём с конца: моё сообщение раньше чужого приглашения — значит, я уже ответил.
    const list = this.messages();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].from === this.me) {
        return null;
      }
      if (list[i].invite) {
        // Вчерашнее «сегодня вечером» уже прошло: согласие одним нажатием создало бы ложный план.
        // Ответить можно обычным сообщением.
        return inviteAge(list[i].createdAt) === 'fresh' ? list[i].id : null;
      }
    }
    return null;
  });

  // «Я в деле!» — согласие одним нажатием: отправляем сразу, как обычное сообщение.
  // Набранный черновик не трогаем — он остаётся в поле.
  protected acceptInvite(): void {
    if (this.sending() || this.state() !== 'ready') {
      return;
    }
    this.sending.set(true);
    this.input()?.nativeElement.focus();
    void this.deliver(this.matchId(), this.i18n.translate('chat.invite.accept'));
  }

  // Отправка формы кнопкой: отменяем «родное» поведение браузера (перезагрузку страницы)
  // и отправляем сообщение сами.
  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.send();
  }

  // «Повторить» у неотправленного сообщения: убираем его из списка ошибок и пробуем ещё раз.
  // Если снова не выйдет — deliver опять положит его в конец списка ошибок.
  protected resend(message: FailedMessage): void {
    if (this.state() !== 'ready') {
      return;
    }
    this.failed.update((list) => list.filter((m) => m.id !== message.id));
    void this.deliver(this.matchId(), message.text);
  }

  // «Удалить» у неотправленного: человек передумал его отправлять.
  protected discard(message: FailedMessage): void {
    this.failed.update((list) => list.filter((m) => m.id !== message.id));
    // Кнопка, на которой был фокус, исчезла вместе с пузырём — возвращаем фокус в поле ввода,
    // иначе он «упадёт» на <body> и клавиатурный пользователь потеряет место.
    this.input()?.nativeElement.focus();
  }

  // Плашка «Новые сообщения ↓»: плавно едем вниз (или сразу, если человек просил меньше анимации).
  protected scrollToBottom(): void {
    const list = this.list()?.nativeElement;
    if (!list) {
      return;
    }
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo({ top: list.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
    this.newBelow.set(false);
    // Плашка-кнопка сейчас исчезнет — фокус переводим на сам список, чтобы он не потерялся.
    list.focus({ preventScroll: true });
  }

  // Каждая прокрутка списка: запоминаем, внизу ли человек. Доскроллил до низа сам — плашка не нужна.
  protected onScroll(): void {
    const list = this.list()?.nativeElement;
    if (!list) {
      return;
    }
    this.nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
    if (this.nearBottom && this.newBelow()) {
      this.newBelow.set(false);
    }
  }

  // Сама запись. Запоминаем, в какой чат отправляем: пока ждём сервер, человек может перейти
  // в другой чат, и тогда ответ (успех или ошибка) к открытому сейчас чату уже не относится.
  private async deliver(matchId: string, text: string): Promise<void> {
    try {
      // Приглашение ли это: в тексте осталась первая фраза приглашения (человек мог дописать
      // что-то своё — метка всё равно ставится).
      const invite = text.includes(this.invite().opener);
      await this.chat.send(matchId, this.me, text, invite);
    } catch (error) {
      if (matchId !== this.matchId()) {
        return;
      }
      // Нет доступа или документа — ВОЗМОЖНО, мэтча уже нет. Но правила могут отказать и при живом
      // мэтче (например, текст не прошёл проверку) — поэтому спрашиваем сервер, есть ли мэтч.
      if (this.isMatchGone(error) && !(await this.matchStillExists(matchId))) {
        if (matchId === this.matchId()) {
          this.end();
          this.sending.set(false);
        }
        return;
      }
      if (matchId !== this.matchId()) {
        return;
      }
      // Сообщение не ушло: показываем его в конце переписки с пометкой «Не отправлено»
      // и кнопкой «Повторить» — текст не теряется, и видно, какое именно сообщение не дошло.
      const id = `failed-${++this.failedSeq}`;
      this.failed.update((list) => [...list, { id, text }]);
      // Глазами ошибку видно по пузырю, а программе чтения с экрана сообщаем через живую область.
      // Нет сети — просим проверить интернет; иначе — нейтральное «не получилось, попробуй ещё раз».
      const key = isNetworkErrorKey(firestoreErrorKey(error))
        ? 'chat.sendErrorNetwork'
        : 'chat.sendError';
      this.announcement.set([{ key: id, lines: [this.i18n.translate(key)] }]);
    }
    if (matchId === this.matchId()) {
      this.sending.set(false);
    }
  }

  // Кнопка отправки не забирает фокус у поля ввода: если фокус уйдёт на кнопку, на телефоне
  // спрячется клавиатура. preventDefault у pointerdown отменяет только «перевод фокуса»,
  // а click (и отправка формы) всё равно происходит.
  protected keepFocus(event: PointerEvent): void {
    event.preventDefault();
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  // Мэтч разорван или собеседник заблокирован — чата больше нет, возвращаемся к списку мэтчей.
  protected leave(): void {
    void this.router.navigateByUrl('/matches');
  }

  // Я подтвердил разрыв/блокировку в меню «⋮», запрос ещё в пути. Мэтч вот-вот пропадёт —
  // это не «собеседник ушёл», поэтому плашку «Чат завершён» не показываем.
  // Дальше одно из трёх: removed (успех — уходим, см. leave), removeFailed (ошибка — см.
  // onRemoveFailed) или, на всякий случай, таймер: если за LEAVING_TIMEOUT_MS ни того ни другого
  // не случилось (например, запрос завис без сети), перестаём ждать и смотрим, что на сервере.
  protected onRemoving(): void {
    const matchId = this.matchId();
    this.leaving = true;
    clearTimeout(this.leavingTimer);
    this.leavingTimer = setTimeout(() => {
      if (matchId === this.matchId()) {
        this.finishLeaving(matchId, true);
      }
    }, LEAVING_TIMEOUT_MS);
  }

  // Разрыв/блокировка не удались (меню «⋮» уже показало ошибку). Чат не должен остаться
  // «замороженным»: снимаем флаг ухода и показываем всё, что пришло, пока мы ждали.
  protected onRemoveFailed(): void {
    this.finishLeaving(this.matchId(), false);
  }

  // На компьютере Enter отправляет, Shift+Enter — перенос строки (как в мессенджерах).
  // На телефоне (сенсорный экран, pointer: coarse) Enter — просто новая строка, а отправляют кнопкой:
  // по экранной клавиатуре легко промахнуться, а отправленное сообщение уже не вернуть.
  // isComposing — человек ещё набирает символ через IME (китайский, японский, корейский ввод):
  // такой Enter подтверждает выбор иероглифа, а не отправляет сообщение.
  protected onEnter(event: Event): void {
    const keyboard = event as KeyboardEvent;
    if (keyboard.isComposing || keyboard.shiftKey || this.isTouch()) {
      return;
    }
    event.preventDefault();
    void this.send();
  }

  private isTouch(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  // Ожидание «своего» ухода закончилось, а со страницы мы так и не ушли.
  // afterTimeout — сработал таймер: запрос мог просто затянуться и всё-таки удалить мэтч.
  private finishLeaving(matchId: string, afterTimeout: boolean): void {
    if (!this.leaving) {
      return;
    }
    const suppressed = this.endSuppressed;
    this.stopLeaving();
    if (suppressed) {
      // Пока «уходили», мы игнорировали признаки завершения. Проверяем их на сервере.
      // Если мэтча действительно нет, а ждали мы своего же медленного разрыва, — плашка
      // «Чат завершён» была бы странной: человек сам этого хотел. Просто уходим к мэтчам.
      if (afterTimeout) {
        void this.matchStillExists(matchId).then((exists) => {
          if (matchId !== this.matchId()) {
            return;
          }
          if (exists) {
            this.applyPending();
          } else {
            this.leave();
          }
        });
      } else {
        this.verifyEnded(matchId);
      }
      return;
    }
    // Признаков завершения не было — просто применяем отложенный снимок переписки (если есть).
    this.applyPending();
  }

  private applyPending(): void {
    const pending = this.pendingMessages;
    this.pendingMessages = null;
    if (pending && this.state() === 'ready' && !this.verifying) {
      this.applyMessages(pending, false);
    }
  }

  private stopLeaving(): void {
    clearTimeout(this.leavingTimer);
    this.leaving = false;
    this.endSuppressed = false;
  }

  // Новый снимок переписки. Здесь три задачи: не трогать «замороженный» завершённый чат;
  // заметить, что сообщения начали исчезать (их стирают перед удалением мэтча);
  // и подготовить озвучку для новых входящих.
  private onMessages(matchId: string, messages: ChatMessage[], fromCache: boolean): void {
    if (matchId !== this.matchId() || this.state() === 'ended') {
      return;
    }
    // По одному сообщения в этом приложении никто не удаляет — их стирают только вместе с мэтчем
    // (разрыв или блокировка). Поэтому «сообщений стало меньше» — повод заподозрить конец чата,
    // но не доказательство (снимок мог прийти из неполного кэша). Пока сервер не ответил,
    // переписку «замораживаем», а последний снимок откладываем, чтобы применить, если мэтч жив.
    // Считаем только подтверждённые сервером: если сервер отклонил МОЁ неотправленное сообщение,
    // Firestore убирает его из списка — это не признак конца чата (см. FailedMessage).
    const confirmed = (list: ChatMessage[]) => list.filter((m) => !m.pending).length;
    const shrunk = confirmed(messages) < confirmed(this.messages());
    // Пока я сам разрываю мэтч, переписку замораживаем, только когда она начала исчезать:
    // обычные снимки (новое входящее, «часики» → галочка) показываем как всегда — иначе
    // при неудачном разрыве чат выглядел бы зависшим.
    if (
      this.state() === 'ready' &&
      (this.verifying || shrunk || (this.leaving && this.endSuppressed))
    ) {
      this.pendingMessages = messages;
      if (this.leaving) {
        // Сам ухожу — сообщения стираются из-за моего же разрыва. Просто не показываем это.
        // Если уход сорвётся, отложенный снимок применит finishLeaving.
        this.endSuppressed = true;
        return;
      }
      this.verifyEnded(matchId);
      return;
    }
    this.applyMessages(messages, fromCache);
  }

  private applyMessages(messages: ChatMessage[], fromCache: boolean): void {
    this.messages.set(messages);
    this.sending.set(false);

    const seen = this.seenIds;
    if (!seen) {
      // Первый пустой снимок из кэша — это «кэш ещё пуст», а не «переписки нет». Точку отсчёта
      // ставим по следующему снимку — иначе вся пришедшая с сервера история была бы «новой»
      // и программа чтения с экрана зачитала бы её целиком.
      if (fromCache && messages.length === 0) {
        return;
      }
    } else {
      // Озвучиваем ВСЕ новые входящие из снимка (их может прийти несколько сразу, например
      // после восстановления сети), а не только последнее.
      const fresh = messages.filter(
        (m) =>
          m.from !== this.me &&
          !seen.has(m.id) &&
          (!m.createdAt || m.createdAt.getTime() >= this.seenUntil),
      );
      if (fresh.length) {
        const speaker = this.i18n.translate('chat.speaker.partner', { name: this.partnerName() });
        this.announcement.set([
          { key: fresh.at(-1)!.id, lines: fresh.map((m) => `${speaker} ${m.text}`) },
        ]);
      }
    }
    this.seenIds = new Set(messages.map((m) => m.id));
    // Берём только ВХОДЯЩИЕ: их время ставит сервер, а у моих неотправленных — примерное время
    // по часам телефона, которые могут спешить (и тогда «новое» входящее казалось бы старым).
    for (const m of messages) {
      if (m.from !== this.me && m.createdAt) {
        this.seenUntil = Math.max(this.seenUntil, m.createdAt.getTime());
      }
    }
  }

  // Подозрение, что чат завершён (сообщения исчезли, ошибка доступа). Спрашиваем сервер:
  // мэтча нет — завершаем; есть — это была ложная тревога, применяем отложенный снимок переписки.
  private verifyEnded(matchId: string): void {
    if (this.verifying) {
      return;
    }
    this.verifying = true;
    void this.matchStillExists(matchId).then((exists) => {
      if (matchId !== this.matchId()) {
        return;
      }
      this.verifying = false;
      const pending = this.pendingMessages;
      this.pendingMessages = null;
      if (!exists) {
        this.end();
      } else if (pending && this.state() === 'ready') {
        this.applyMessages(pending, false);
      }
    });
  }

  // Есть ли мэтч на сервере. Если проверить не удалось (нет сети) — считаем, что есть:
  // ошибочно «завершить» живой чат хуже, чем показать на минуту устаревшую переписку.
  // Настоящее удаление всё равно придёт через подписку watchMatch, когда появится сеть.
  private async matchStillExists(matchId: string): Promise<boolean> {
    try {
      return await this.chat.matchExists(matchId);
    } catch (error) {
      console.error(error);
      return true;
    }
  }

  // Чат завершён посреди разговора. Срабатывает только для уже открытого чата: если мэтча нет
  // с самого начала, это решает loadPartner (состояние notFound).
  // Если я сам сейчас разрываю мэтч — молчим: через мгновение уйдём на /matches.
  private end(): void {
    if (this.leaving) {
      this.endSuppressed = true;
      return;
    }
    if (this.state() === 'ready') {
      this.state.set('ended');
      this.sending.set(false);
    }
  }

  // permission-denied — правила не пускают (мэтча нет), not-found — обновлять уже нечего.
  private isMatchGone(error: unknown): boolean {
    return (
      isPermissionDenied(error) || (error instanceof FirebaseError && error.code === 'not-found')
    );
  }

  private async loadPartner(matchId: string): Promise<void> {
    let partnerUid: string | null;
    try {
      partnerUid = await this.chat.loadPartner(matchId, this.me);
    } catch (error) {
      this.fail(matchId, error);
      return;
    }
    if (!partnerUid) {
      if (matchId === this.matchId()) {
        this.state.set('notFound');
      }
      return;
    }
    // Анкеты нужны только для красоты (имя, фото, общие игры) — без них чат всё равно работает.
    const [partner, myProfile, contacts] = await Promise.all([
      this.profiles.loadPublic(partnerUid).catch(() => null),
      this.profiles.loadPublic(this.me).catch(() => null),
      this.profiles.loadContacts(partnerUid).catch(() => null),
    ]);
    // Пока грузили, пользователь мог уйти в другой чат — тогда этот результат уже не нужен.
    if (matchId !== this.matchId()) {
      return;
    }
    this.partner.set(partner);
    this.partnerUid.set(partnerUid);
    const match = partner && myProfile ? matchScore(myProfile, partner) : null;
    this.commonGames.set(match?.commonGames ?? []);
    this.commonPlayTimes.set(match?.commonPlayTimes ?? []);
    this.commonPlatforms.set(match?.commonPlatforms ?? []);
    this.partnerContacts.set(contacts);
    this.state.set('ready');
  }

  // Ошибка доступа — мэтча нет или он чужой (так решают firestore.rules). Остальное — повод повторить.
  // Если чат уже был открыт, ошибка доступа — повод проверить, не удалили ли мэтч.
  private fail(matchId: string, error: unknown): void {
    // Ответ от прошлого чата или от «замороженного» завершённого — уже не важен.
    if (matchId !== this.matchId() || this.state() === 'ended') {
      return;
    }
    if (this.state() === 'ready' && isPermissionDenied(error)) {
      if (this.leaving) {
        this.endSuppressed = true;
        return;
      }
      // Подписка после ошибки уже не работает. Мэтча нет — чат завершён; есть — честно
      // показываем ошибку с кнопкой «Попробовать ещё раз», а не «Чат завершён».
      void this.matchStillExists(matchId).then((exists) => {
        if (matchId !== this.matchId() || this.state() !== 'ready') {
          return;
        }
        if (exists) {
          this.errorKey.set(firestoreErrorKey(error));
          this.state.set('error');
        } else {
          this.end();
        }
      });
      return;
    }
    if (isPermissionDenied(error)) {
      this.state.set('notFound');
    } else {
      this.errorKey.set(firestoreErrorKey(error));
      this.state.set('error');
    }
  }
}
