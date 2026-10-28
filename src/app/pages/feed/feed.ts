import {
  Component,
  DOCUMENT,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { map, take } from 'rxjs';
import { Clipboard } from '@angular/cdk/clipboard';
import { FirebaseError } from 'firebase/app';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/auth/auth';
import { firestoreErrorKey } from '../../core/firebase/firestore-errors';
import { I18n } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { MatchInfo, matchScore } from '../../core/matching/match-score';
import { LikeOutcome, PendingLikes } from '../../core/matching/pending-likes';
import { SwipeService, matchId } from '../../core/matching/swipes';
import { NotificationService } from '../../core/notifications/notifications';
import { ProfileService } from '../../core/profile/profile';
import {
  PLATFORMS,
  Platform,
  Player,
  UserProfile,
  ageFrom,
} from '../../core/profile/profile.model';
import { ErrorState } from '../../shared/error-state/error-state';
import { StateMessage } from '../../shared/state-message/state-message';
import { MatchDialog, MatchDialogData, MatchDialogResult } from './match-dialog/match-dialog';
import { PlayerCard } from './player-card/player-card';

const MIN_AGE = 18;
const MAX_AGE = 99;
// Сколько серых карточек-заготовок показать в сетке, пока лента грузится.
const SKELETON_CARDS = 6;
// Сколько после лайка/пропуска кнопки «не слышат» нажатий. Карточки за это время
// перестраиваются, и второе быстрое нажатие попало бы по игроку, которого ещё не видно.
const SETTLE_MS = 400;
// Сколько ждать сервер при «Вернуть». Без сети запрос висел бы вечно, а человек — ждал.
const UNDO_TIMEOUT_MS = 8000;
// Сколько лайк «ждёт» перед отправкой. Всё это время в строке «последнее действие» есть
// «Вернуть»: промахнулся пальцем — успеешь передумать, и второй человек ничего не узнает.
const LIKE_UNDO_MS = 4000;
// Сколько висит строка, в которой уже нечего нажать («Приглашение отправлено», «Снова в ленте»).
// Это просто подтверждение: прочитал — и хватит. Висела бы вечно — в сетке закрывала бы карточки.
// С пояснением о контактах (целое предложение) — дольше: его надо успеть дочитать.
const STATUS_CLEAR_MS = 4000;
const STATUS_CLEAR_LONG_MS = 8000;
// Ключи localStorage: фильтры и вид ленты переживают переход на другую страницу и перезагрузку.
// Фильтры — у каждого аккаунта свои (к ключу добавляется uid): следующий человек на этом
// компьютере не должен получить чужой город и возраст.
const STORAGE = {
  filters: 'di-feed-filters',
  view: 'di-feed-view',
  filtersOpen: 'di-feed-filters-open',
};

type View = 'deck' | 'grid';
type Direction = 'like' | 'skip';

interface FeedItem {
  player: Player;
  age: number;
  match: MatchInfo;
  likedMe: boolean;
}

// Последнее действие — строка под колодой: «Приглашение отправляется: Alex · Вернуть»,
// «Приглашение отправлено: Alex» или «Пропущено: Alex · Вернуть».
// Это и подтверждение (особенно когда анимации выключены), и место для отмены лайка или пропуска.
// sending — лайк ещё НЕ записан (ждёт LIKE_UNDO_MS или уже пишется), liked — сервер подтвердил.
// Честный статус: «отправлено» показываем только тогда, когда это уже правда.
interface LastAction {
  kind: 'sending' | 'liked' | 'skipped' | 'restored';
  player: Player;
  // Первый лайк на этом аккаунте — под строкой объясняем, что контакты пока скрыты.
  consentNote?: boolean;
  // Можно ли ещё отменить: пропуск — всегда, лайк — только пока он ждёт отправки.
  undoable?: boolean;
}

// Поля ввода и списки, где буквы и Backspace — это набор текста или поиск по пунктам,
// а не наша горячая клавиша «Вернуть».
const TEXT_ENTRY =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), ' +
  '[role="combobox"], [role="listbox"], [role="option"], [role="menu"], [role="menuitem"]';

@Component({
  selector: 'app-feed',
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    TranslatePipe,
    PlayerCard,
    ErrorState,
    StateMessage,
  ],
  templateUrl: './feed.html',
  styleUrl: './feed.scss',
  // Стрелки ← / → в режиме «по одному» — пропустить / лайкнуть, Z или Backspace — вернуть.
  // Свёрнутую или закрытую вкладку (отправить отложенные лайки сразу) ловит сам PendingLikes.
  host: {
    '(document:keydown)': 'onKeydown($event)',
    // Где сейчас фокус — для «сторожа» пропавшей карточки (см. onFocusIn).
    '(document:focusin)': 'onFocusIn($event)',
    // Где сейчас мышь — для паузы таймера лайка (см. onPointer). Слушаем весь документ,
    // а не саму строку: её pointerleave не придёт, если строку перерисовали в другом месте
    // (колода → «пусто») или мышь ушла за окно, — и пауза «залипала» бы навсегда.
    '(document:pointermove)': 'onPointer($event)',
    '(document:pointerover)': 'onPointer($event)',
    '(document:pointerout)': 'onPointerOut($event)',
    '(window:blur)': 'lineHovered.set(false)',
  },
})
export class Feed {
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(ProfileService);
  private readonly swipes = inject(SwipeService);
  // Очередь отложенных лайков живёт в сервисе, а не здесь: лента закроется, а лайк должен дойти.
  private readonly pendingLikes = inject(PendingLikes);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly clipboard = inject(Clipboard);
  private readonly i18n = inject(I18n);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  protected readonly notifications = inject(NotificationService);

  protected readonly platforms = PLATFORMS;
  protected readonly minAge = MIN_AGE;
  protected readonly maxAge = MAX_AGE;
  protected readonly skeletons = Array.from({ length: SKELETON_CARDS }, (_, i) => i);

  protected readonly loading = signal(true);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly me = signal<UserProfile | null>(null);
  protected readonly players = signal<Player[]>([]);
  // uid тех, кого я уже лайкнул или пропустил.
  private readonly swiped = signal(new Set<string>());
  // Куда улетает карточка: лайк — вправо, пропуск — влево. Шаблон берёт отсюда класс для animate.leave.
  private readonly swipeDirections = new Map<string, Direction>();
  // Незавершённые сохранения пропусков: «Вернуть» сначала дождётся записи, потом удалит её.
  private readonly pendingSkips = new Map<string, Promise<void>>();
  // Игроки, убранные через «⋮» (заблокированы). Убираем сразу, не дожидаясь, пока блокировка
  // придёт из Firestore в notifications.hidden.
  private readonly removedUids = signal(new Set<string>());
  // uid карточки, внутри которой фокус был последним (или чьё меню «⋮» сейчас открыто: меню
  // и окно подтверждения живут вне карточки, в оверлее, поэтому uid при этом не сбрасываем).
  // Если такая карточка пропадёт из списка сама — например, блокировка пришла из Firestore
  // раньше, чем меню успело сообщить (removed), — фокус переведём на соседнюю. См. watchFocusedCard.
  private focusedCardUid: string | null = null;
  // Порядок карточек на прошлом шаге — чтобы знать, на каком месте стояла пропавшая.
  private previousUids: string[] = [];
  // Указатель мыши над строкой «последнее действие» / фокус внутри неё / нажата «Пауза».
  // Пока хоть одно верно — таймер отложенного лайка стоит на паузе (и полоска прогресса тоже).
  protected readonly lineHovered = signal(false);
  private readonly lineFocused = signal(false);
  // uid игрока, чей лайк поставлен на паузу кнопкой. Мышь и фокус — удобство, но скринридер
  // в режиме чтения (browse mode) не двигает ни то, ни другое: человек слушает строку, а таймер
  // идёт. Явная кнопка «Пауза» работает везде — её «нажимает» и виртуальный курсор.
  protected readonly heldByButton = signal<string | null>(null);
  protected readonly lineHeld = computed(
    () =>
      this.lineHovered() ||
      this.lineFocused() ||
      (this.heldByButton() !== null && this.heldByButton() === this.lastAction()?.player.uid),
  );
  // uid лайка, чей таймер сейчас на паузе.
  private heldUid: string | null = null;
  // Игрок, которого только что вернули, — он встаёт первым, даже если сортировка за это время
  // поменялась (например, кто-то лайкнул меня и поднялся наверх).
  private readonly frontUid = signal<string | null>(null);
  // Страницу уже закрыли — окно «Это мэтч!» поверх другой страницы не открываем.
  private destroyed = false;
  // Длительность полоски «сколько осталось до отправки» — та же, что у таймера.
  protected readonly likeUndoMs = LIKE_UNDO_MS;

  protected readonly view = signal<View>(readStorage(STORAGE.view) === 'grid' ? 'grid' : 'deck');
  protected readonly filtersOpen = signal(readStorage(STORAGE.filtersOpen) === '1');
  protected readonly settling = signal(false);
  protected readonly lastAction = signal<LastAction | null>(null);
  // uid игрока, которого сейчас «возвращаем», — кнопка «Вернуть» на это время выключена.
  protected readonly restoring = signal<string | null>(null);
  // Текст для живой области скринридера. Одна область на всё: несколько объявлений сразу
  // перебивали бы друг друга.
  protected readonly announcement = signal('');
  // Подсказку «добавь время игры и жанры» скрыли — помним это для каждого аккаунта отдельно.
  private readonly hintDismissed = signal(readStorage(this.hintKey) === '1');
  // Пояснение «контакты откроются только при взаимности» уже показывали этому аккаунту.
  // Показываем один раз, при первом лайке: дальше это знание, а не новость.
  // signal, а не просто поле: от него зависит подсказка у кнопки «Player 2?» в шаблоне.
  private readonly consentNoteSeen = signal(readStorage(this.consentKey) === '1');

  // Короткое пояснение под «Player 2?» — пока человек ни разу не лайкал. После первого лайка
  // эстафету принимает заметка в строке «последнее действие», а потом обе исчезают.
  protected readonly likeHint = computed(() => !this.consentNoteSeen());

  // Подсказка нужна, если в профиле нет времени игры или жанров: без них совпадения беднее.
  protected readonly profileHint = computed(() => {
    const me = this.me();
    return !!me && !this.hintDismissed() && (!me.playTimes.length || !me.genres.length);
  });
  private settleTimer: ReturnType<typeof setTimeout> | undefined;

  // Тот же текст, что в видимой строке, — для живой области скринридера.
  protected readonly lastActionText = computed(() => {
    const last = this.lastAction();
    if (!last) {
      return '';
    }
    // Пока действие можно отменить, говорим об этом и скринридеру: «…Можно вернуть».
    const key = last.undoable ? `feed.announce.${last.kind}` : `feed.last.${last.kind}`;
    const text = this.i18n.translate(key, { name: last.player.name });
    // Два целых предложения, а не склейка обрывков — так переводчику проще и порядок слов свой.
    return last.consentNote ? `${text}. ${this.i18n.translate('feed.last.consent')}` : text;
  });

  // Ещё не просмотренные игроки — только их и показываем.
  // Заблокированные (в любую сторону) пропадают сразу: hidden обновляется в реальном времени.
  protected readonly remaining = computed(() => {
    const hidden = this.notifications.hidden();
    const removed = this.removedUids();
    return this.players().filter(
      (player) =>
        !this.swiped().has(player.uid) && !hidden.has(player.uid) && !removed.has(player.uid),
    );
  });

  protected readonly filters = inject(NonNullableFormBuilder).group({
    game: [''],
    platform: ['' as Platform | ''],
    city: [''],
    minAge: [MIN_AGE],
    maxAge: [MAX_AGE],
  });

  // Значения фильтров как signal: меняется любой фильтр — results ниже пересчитывается сам.
  private readonly filterValues = toSignal(
    this.filters.valueChanges.pipe(map(() => this.filters.getRawValue())),
    { initialValue: this.filters.getRawValue() },
  );

  // Сколько фильтров включено — число на кнопке «Фильтры», когда панель свёрнута.
  protected readonly activeFilters = computed(() => {
    const { game, platform, city, minAge, maxAge } = this.filterValues();
    const ageChanged = (minAge || MIN_AGE) !== MIN_AGE || (maxAge || MAX_AGE) !== MAX_AGE;
    return [game, platform, city.trim(), ageChanged].filter(Boolean).length;
  });

  // Варианты для фильтра «Игра» двумя группами: сначала мои игры, потом игры других игроков.
  protected readonly gameOptions = computed(() => {
    const mine = [...new Set(this.me()?.games ?? [])].sort((a, b) => a.localeCompare(b));
    const known = new Set(mine.map((game) => game.toLowerCase()));
    const others = new Map<string, string>();
    for (const game of this.players().flatMap((player) => player.games)) {
      const key = game.toLowerCase();
      if (!known.has(key) && !others.has(key)) {
        others.set(key, game);
      }
    }
    return { mine, others: [...others.values()].sort((a, b) => a.localeCompare(b)) };
  });

  // Главная часть ленты: считаем совместимость, фильтруем.
  // Порядок: сначала те, кто уже лайкнул меня (лайк в ответ = мэтч), дальше — по совместимости.
  protected readonly results = computed<FeedItem[]>(() => {
    const me = this.me();
    if (!me) {
      return [];
    }
    const { game, platform, city, minAge, maxAge } = this.filterValues();
    // Пустое числовое поле даёт null — тогда считаем, что ограничения нет.
    // «От 40 до 25» не ошибка, а перепутанные поля: просто меняем их местами.
    const a = clampAge(minAge || MIN_AGE);
    const b = clampAge(maxAge || MAX_AGE);
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    const cityQuery = city.trim().toLowerCase();
    const likedMe = this.notifications.likedMe();
    const front = this.frontUid();

    return this.remaining()
      .map((player) => ({
        player,
        age: ageFrom(player.birthDate),
        match: matchScore(me, player),
        likedMe: likedMe.has(player.uid),
      }))
      .filter(
        ({ player, age }) =>
          age >= from &&
          age <= to &&
          (!game || player.games.some((g) => g.toLowerCase() === game.toLowerCase())) &&
          (!platform || player.platforms.includes(platform)) &&
          (!cityQuery || player.city.toLowerCase().includes(cityQuery)),
      )
      .sort(
        (a, b) =>
          Number(b.player.uid === front) - Number(a.player.uid === front) ||
          Number(b.likedMe) - Number(a.likedMe) ||
          b.match.percent - a.match.percent,
      );
  });

  // В колоде рисуем двух: текущего и следующего «выглядывающего» из-за него.
  protected readonly deck = computed(() => this.results().slice(0, 2));
  protected readonly current = computed(() => this.results()[0] ?? null);

  constructor() {
    this.restoreFilters();
    this.filters.valueChanges.subscribe(() => {
      writeStorage(this.filtersKey, JSON.stringify(this.filters.getRawValue()));
      // Число найденных объявляем только при смене фильтров, а не после каждого лайка.
      this.announcement.set(this.i18n.translate('feed.count', { count: this.results().length }));
      // Строка про прошлое действие к новой выборке уже не относится (раньше она доживала
      // даже до «никто не подходит под фильтры»).
      this.dropLastAction();
    });
    void this.load();
    // effect — функция, которую Angular перезапускает, когда меняется любой прочитанный в ней
    // signal. Первый: строка «последнее действие» сменилась или на неё навели / с неё ушли —
    // ставим таймер нужного лайка на паузу или запускаем снова. Второй: следит, не пропала ли
    // карточка с фокусом (см. watchFocusedCard).
    effect(() => this.syncHold());
    // Строка без кнопок («отправлено», «вернулся») уходит сама через несколько секунд.
    // onCleanup — Angular вызовет его, когда строка сменится раньше: старый таймер не сработает.
    effect((onCleanup) => {
      const last = this.lastAction();
      if (last?.kind !== 'liked' && last?.kind !== 'restored') {
        return;
      }
      const ms = last.consentNote ? STATUS_CLEAR_LONG_MS : STATUS_CLEAR_MS;
      const timer = setTimeout(() => this.clearLastAction(last), ms);
      onCleanup(() => clearTimeout(timer));
    });
    // untracked — всё, что внутри, не делает effect зависимым от новых signal'ов; заодно
    // Angular разрешает звать там afterNextRender (из «реактивного» кода — нельзя).
    effect(() => {
      const list = this.results();
      untracked(() => this.watchFocusedCard(list));
    });
    // Строка «последнее действие» сменилась — её могли перерисовать в другом месте (последняя
    // карточка ушла, и вместо колоды — «пусто»). Старый элемент удалён, а «прощальных» событий
    // (pointerleave, focusout) удалённый элемент не присылает. Пересчитываем по факту:
    // мышь заново «увидит» строку при первом же движении (onPointer), фокус — смотрим, где он.
    effect(() => {
      this.lastAction();
      untracked(() => {
        this.lineHovered.set(false);
        afterNextRender(
          () => this.lineFocused.set(!!this.document.activeElement?.closest('.last-action')),
          { injector: this.injector },
        );
      });
    });
    // Уход со страницы (другой маршрут) уничтожает компонент — отложенные лайки НЕ теряем,
    // а отправляем сразу. Дописывает их PendingLikes: он живёт дольше страницы,
    // и «Выйти» в шапке дождётся его, прежде чем выйти из аккаунта.
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      clearTimeout(this.settleTimer);
      void this.pendingLikes.flush();
    });
  }

  // Кнопка «Спробувати ще раз» на ошибке загрузки.
  protected retry(): void {
    void this.load();
  }

  // Класс анимации ухода карточки. Карточка без направления (например, заблокированный игрок)
  // просто тает.
  protected leaveClass(uid: string): string {
    const direction = this.swipeDirections.get(uid);
    return direction ? `fly-${direction}` : 'di-leave';
  }

  protected resetFilters(): void {
    this.filters.reset();
  }

  protected toggleFilters(): void {
    this.filtersOpen.update((open) => !open);
    writeStorage(STORAGE.filtersOpen, this.filtersOpen() ? '1' : '0');
  }

  protected setView(view: View): void {
    if (view !== this.view()) {
      this.dropLastAction();
    }
    this.view.set(view);
    writeStorage(STORAGE.view, view);
  }

  // clipboard.copy() возвращает false, если браузер не дал скопировать (нет разрешения,
  // старый браузер). Тогда честно говорим об этом и показываем саму ссылку — её можно
  // выделить и скопировать руками.
  protected copyInvite(): void {
    const url = this.document.location.origin;
    if (this.clipboard.copy(url)) {
      this.snackBar.open(this.i18n.translate('feed.inviteCopied'), undefined, { duration: 4000 });
    } else {
      this.snackBar.open(this.i18n.translate('feed.inviteCopyFailed', { url }), undefined, {
        duration: 10000,
      });
    }
  }

  // Лайк не уходит сразу: LIKE_UNDO_MS он ждёт в PendingLikes, и пока можно нажать «Вернуть».
  // Исключение — игрок уже лайкнул меня: это мгновенный мэтч, отправляем сразу и показываем
  // «Это мэтч!» — окно само всё объясняет, а отменять мэтч «на всякий случай» незачем.
  // Ошибку сохранения swipe() обработает как обычно: вернёт карточку и покажет сообщение.
  protected like(player: Player): void {
    // uid берём СЕЙЧАС, а не в момент отправки: отложенный лайк может уйти уже после ухода
    // со страницы, а ответ — прийти, когда из аккаунта вышли и auth.user() — null.
    const uid = this.uid;
    if (this.notifications.likedMe().has(player.uid)) {
      this.swipe(player, 'like', () =>
        this.pendingLikes
          .likeNow(uid, player.uid)
          .then((outcome) => this.likeDone(player, uid, outcome)),
      );
      return;
    }
    this.swipe(
      player,
      'like',
      () =>
        this.pendingLikes
          .schedule(uid, player.uid, LIKE_UNDO_MS, () => this.likeSending(player.uid))
          .then((outcome) => this.likeDone(player, uid, outcome)),
      true,
    );
  }

  // Отменить ещё не отправленный лайк: таймер выключаем, карточку возвращаем.
  // Сервер ничего не знает, поэтому ждать нечего — всё происходит мгновенно.
  protected undoLike(player: Player): void {
    if (!this.pendingLikes.cancel(this.uid, player.uid)) {
      return;
    }
    // Пояснение о скрытых контактах человек уже прочитал — заново его не показываем.
    this.restoreCard(player);
  }

  // Кнопка «Пауза» / «Отправить» в строке ожидающего лайка. Первое нажатие — пауза без срока
  // (таймер стоит, пока человек не решит), второе — отправить сразу, не дожидаясь конца.
  // Кнопка одна и та же (меняются только текст и иконка), поэтому фокус с неё не слетает.
  protected toggleHold(player: Player): void {
    if (this.heldByButton() === player.uid) {
      this.heldByButton.set(null);
      this.pendingLikes.release(this.uid, player.uid);
      return;
    }
    this.heldByButton.set(player.uid);
    this.announcement.set(this.i18n.translate('feed.announce.held', { name: player.name }));
  }

  // Мышь над строкой «последнее действие» — пауза. Только мышь: на телефоне «наведение»
  // эмулируется тапом, и «ухода» может не случиться вовсе — таймер замер бы навсегда.
  // Каждое движение указателя заново отвечает на вопрос «я над строкой?», поэтому ошибка
  // не копится: даже если что-то пропустили, следующее движение мыши всё исправит.
  // set() с тем же значением signal игнорирует — частый pointermove ничего не перерисовывает.
  protected onPointer(event: PointerEvent): void {
    const target = event.target as Element | null;
    this.lineHovered.set(event.pointerType === 'mouse' && !!target?.closest?.('.last-action'));
  }

  // relatedTarget === null — указатель ушёл за пределы окна (или касание закончилось).
  protected onPointerOut(event: PointerEvent): void {
    if (!event.relatedTarget) {
      this.lineHovered.set(false);
    }
  }

  // Фокус ушёл из строки — но, может быть, на другой элемент внутри неё же.
  // relatedTarget — элемент, куда фокус переходит (null — «никуда», например окно свернули).
  protected onLineFocusOut(event: FocusEvent): void {
    const line = event.currentTarget as HTMLElement;
    this.lineFocused.set(line.contains(event.relatedTarget as Node | null));
  }

  // Любой фокус на странице. Запоминаем, в какой карточке он сейчас, — см. focusedCardUid.
  // Фокус в оверлее (меню «⋮», окно подтверждения) карточку не «сбрасывает»: это её же меню.
  protected onFocusIn(event: FocusEvent): void {
    const target = event.target as HTMLElement | null;
    // Строку «последнее действие» могли перерисовать в другом месте, и focusout не пришёл.
    this.lineFocused.set(!!target?.closest('.last-action'));
    if (target?.closest('.cdk-overlay-container')) {
      return;
    }
    const card = target?.closest<HTMLElement>('app-player-card[data-uid]');
    this.focusedCardUid = card?.dataset['uid'] ?? null;
  }

  protected skip(player: Player): void {
    this.swipe(player, 'skip', () => {
      const saving = this.swipes.skip(this.uid, player.uid);
      this.pendingSkips.set(player.uid, saving);
      return saving.finally(() => this.pendingSkips.delete(player.uid));
    });
  }

  // «Вернуть» пропущенного: удаляем запись о пропуске, и карточка снова появляется в ленте.
  // «Вернулся» пишем только ПОСЛЕ ответа сервера — иначе обещали бы то, чего ещё не случилось.
  protected async undoSkip(player: Player): Promise<void> {
    if (this.restoring()) {
      return;
    }
    // uid — сейчас: дальше есть await, а за это время могли выйти из аккаунта.
    const uid = this.uid;
    this.restoring.set(player.uid);
    try {
      // Пропуск может ещё сохраняться — ждём. Если он не сохранился, swipe() уже вернул
      // карточку и показал ошибку — второй раз ничего делать не нужно.
      const saved = await (this.pendingSkips.get(player.uid) ?? Promise.resolve()).then(
        () => true,
        () => false,
      );
      if (!saved) {
        return;
      }
      await withTimeout(this.swipes.unskip(uid, player.uid), UNDO_TIMEOUT_MS);
      this.restoreCard(player);
    } catch (error) {
      this.showError('undo', player, error);
    } finally {
      this.restoring.set(null);
    }
  }

  // Игрока убрали через «⋮» (заблокировали). Убираем карточку сами и сразу — на случай,
  // если блокировка ещё не пришла из Firestore. Фокус здесь НЕ трогаем: обычно карточка
  // к этому моменту уже исчезла (Firestore сначала обновляет локальные данные и только потом
  // завершает запись), и тогда этот обработчик вообще не вызовется — некому. Фокусом
  // занимается watchFocusedCard: он срабатывает одинаково, кто бы ни убрал карточку первым.
  protected onRemoved(player: Player): void {
    // Safari не ставит фокус на кнопку при клике мышью — тогда onFocusIn карточку не запомнил.
    // Подстраховка: если карточка ещё в списке, «сторож» последит и за ней.
    if (this.results().some((item) => item.player.uid === player.uid)) {
      this.focusedCardUid = player.uid;
    }
    this.removedUids.update((uids) => new Set(uids).add(player.uid));
  }

  // «Вернуть» из строки «последнее действие» или с клавиатуры: отменяет последний лайк
  // (пока он не отправлен) или последний пропуск.
  protected undoLast(): void {
    const last = this.lastAction();
    if (!last?.undoable) {
      return;
    }
    if (last.kind === 'sending') {
      this.undoLike(last.player);
    } else if (last.kind === 'skipped') {
      void this.undoSkip(last.player);
    }
  }

  // ← пропустить, → лайкнуть. Только в колоде и только когда фокус «на колоде»: на самой
  // странице, на карточке или её кнопках. Стрелка на ссылке в шапке или в поле ввода — не наша.
  protected onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    // Z или Backspace — «Вернуть», в обоих видах. event.code, а не event.key: code — это
    // физическая клавиша, и на русской раскладке (где на её месте «я») она тоже сработает.
    // В полях ввода и списках эти клавиши заняты набором текста — там не перехватываем.
    if (
      (event.code === 'KeyZ' || event.key === 'Backspace') &&
      !event.repeat &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !this.dialog.openDialogs.length &&
      !target?.closest(TEXT_ENTRY) &&
      this.lastAction()?.undoable
    ) {
      event.preventDefault();
      this.undoLast();
      return;
    }
    const current = this.current();
    const onDeck =
      !target ||
      target === this.document.body ||
      target.id === 'feed-title' ||
      (!!target.closest('.deck') && !target.closest('app-moderation-menu, .more-btn'));
    if (
      this.view() !== 'deck' ||
      !current ||
      !onDeck ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      this.dialog.openDialogs.length
    ) {
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.skip(current.player);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.like(current.player);
    }
  }

  // Общая часть лайка и пропуска. Карточку убираем СРАЗУ, не дожидаясь сервера, —
  // интерфейс отвечает мгновенно. Если сохранить не вышло, карточка возвращается.
  // delayed — лайк отложен и его можно отменить (см. like()).
  private swipe(
    player: Player,
    direction: Direction,
    action: () => Promise<void>,
    delayed = false,
  ): void {
    if (this.settling() || this.swiped().has(player.uid)) {
      return;
    }
    const index = this.results().findIndex((item) => item.player.uid === player.uid);
    // Чей это свайп и ключ заметки — запоминаем сейчас: ошибка может прийти уже после выхода
    // из аккаунта, когда this.uid взять неоткуда.
    const owner = this.uid;
    const consentKey = this.consentKey;
    // Фокус после свайпа переводит focusAfterSwipe — «сторож» пропавшей карточки не нужен.
    this.focusedCardUid = null;
    // Новое действие — новая строка: «Пауза» от прошлого лайка к нему не относится.
    this.heldByButton.set(null);
    this.settle();
    // Направление запоминаем ДО того, как карточка пропадёт из списка, —
    // Angular спросит leaveClass в момент удаления.
    this.swipeDirections.set(player.uid, direction);
    // Set внутри signal меняем через update и НОВЫЙ Set — иначе signal не заметит изменения.
    this.swiped.update((uids) => new Set(uids).add(player.uid));
    // Если этот игрок уже лайкнул меня, лайк сразу даст мэтч — обещание «контакты скрыты,
    // пока не ответят» было бы неправдой. Такую заметку не тратим: покажем при следующем лайке.
    const consentNote =
      direction === 'like' &&
      !this.consentNoteSeen() &&
      !this.notifications.likedMe().has(player.uid);
    if (consentNote) {
      this.consentNoteSeen.set(true);
      writeStorage(consentKey, '1');
    }
    this.lastAction.set({
      kind: direction === 'like' ? 'sending' : 'skipped',
      player,
      consentNote,
      undoable: direction === 'skip' || delayed,
    });
    this.announcement.set(this.lastActionText());
    this.focusAfterSwipe(index);

    action().catch((error) => {
      this.swipeDirections.delete(player.uid);
      this.swiped.update((uids) => {
        const next = new Set(uids);
        next.delete(player.uid);
        return next;
      });
      if (consentNote) {
        // Лайк не дошёл — пояснение покажем при следующем, настоящем.
        this.consentNoteSeen.set(false);
        writeStorage(consentKey, '0');
      }
      if (this.lastAction()?.player.uid === player.uid) {
        this.lastAction.set(null);
      }
      // Ленту уже закрыли (лайк ушёл при уходе со страницы) и из аккаунта вышли — сообщение
      // «Приглашение не отправлено» на странице входа только сбило бы с толку: пишем в консоль.
      // Если же человек просто перешёл на другую страницу, честное сообщение нужно: иначе он
      // думал бы, что приглашение ушло.
      if (this.destroyed && this.auth.user()?.uid !== owner) {
        console.error(error);
        return;
      }
      this.showError(direction, player, error);
    });
  }

  // Лайк записан (или отменён). Если тот человек лайкнул меня раньше (или успел, пока лайк
  // ждал), — мэтч. uid — мой, захваченный в like(): к этому моменту из аккаунта могли уже выйти.
  private likeDone(player: Player, uid: string, outcome: LikeOutcome): void {
    if (outcome === 'cancelled') {
      return;
    }
    const matched = outcome === 'matched';
    this.likeSent(player.uid, matched);
    if (!matched) {
      return;
    }
    if (!this.destroyed) {
      this.showMatch(player, uid);
    } else if (this.auth.user()?.uid === uid) {
      // Лайк ушёл, когда человек уже ушёл с ленты: окно поверх чужой страницы было бы
      // странным, а молчать о мэтче нельзя. Короткое сообщение со ссылкой в чат.
      this.showMatchToast(player, uid);
    }
  }

  // Время на «Вернуть» вышло, лайк пишется — кнопка пропадает, текст остаётся «отправляется».
  // Фокус на карточку НЕ переводим (в сетке это был бы прыжок к первой). Если он стоял на
  // «Вернуть» (бывает, только если вкладку свернули: пока фокус на кнопке, таймер на паузе),
  // оставляем его в той же строке — на ней самой (tabindex="-1").
  private likeSending(uid: string): void {
    const last = this.lastAction();
    if (last?.kind !== 'sending' || last.player.uid !== uid || !last.undoable) {
      return;
    }
    const hadFocus = !!this.document.activeElement?.closest('.last-action');
    this.lastAction.set({ ...last, undoable: false });
    if (hadFocus && !this.destroyed) {
      afterNextRender(() => this.document.querySelector<HTMLElement>('.last-action')?.focus(), {
        injector: this.injector,
      });
    }
  }

  // Сервер подтвердил — теперь можно честно сказать «Приглашение отправлено».
  // Скринридеру — коротко и без повтора заметки о контактах. При мэтче молчим: окно
  // «Это мэтч!» скажет всё само.
  private likeSent(uid: string, matched: boolean): void {
    const last = this.lastAction();
    if (last?.kind !== 'sending' || last.player.uid !== uid) {
      return;
    }
    this.lastAction.set({ ...last, kind: 'liked', undoable: false });
    if (!matched) {
      this.announcement.set(this.i18n.translate('feed.last.liked', { name: last.player.name }));
    }
  }

  // Смена вида или фильтров: строку убираем — кроме лайка, который ещё ждёт отправки.
  // Его «Вернуть» и «Пауза» нужны до конца отсчёта, а честное «отправляется» — пока он пишется.
  private dropLastAction(): void {
    const last = this.lastAction();
    if (last && last.kind !== 'sending') {
      this.clearLastAction(last);
    }
  }

  // Убрать строку, если на экране всё ещё она (за это время могло прийти новое действие).
  // Фокус внутри строки (на ней самой — tabindex="-1") не бросаем на <body>: переводим
  // на имя текущей карточки, а если карточек нет — на заголовок страницы.
  private clearLastAction(last: LastAction): void {
    if (this.lastAction() !== last) {
      return;
    }
    const hadFocus = !!this.document.activeElement?.closest('.last-action');
    this.lastAction.set(null);
    if (hadFocus && !this.destroyed) {
      const next = this.current();
      afterNextRender(
        () =>
          this.document
            .getElementById(next ? `player-${next.player.uid}-name` : 'feed-title')
            ?.focus(),
        { injector: this.injector },
      );
    }
  }

  // Пауза таймера: держим только тот лайк, что виден в строке и ещё ждёт. Сменилась строка
  // (новый лайк, «Вернуть», отправка) — прежний лайк «отпускаем», его время идёт дальше.
  private syncHold(): void {
    const last = this.lastAction();
    const uid =
      last?.kind === 'sending' && last.undoable && this.lineHeld() ? last.player.uid : null;
    if (uid === this.heldUid) {
      return;
    }
    // Мой uid — без «!»: effect может сработать и в момент выхода из аккаунта.
    const me = this.auth.user()?.uid;
    if (me && this.heldUid) {
      this.pendingLikes.resume(me, this.heldUid);
    }
    if (me && uid) {
      this.pendingLikes.pause(me, uid);
    }
    this.heldUid = uid;
  }

  // «Сторож» фокуса: карточка, в которой был фокус (или чьё меню «⋮» открыто), пропала
  // из списка не через лайк/пропуск — значит, её заблокировали (в том числе с другого устройства).
  // Неважно, кто успел первым — Firestore или событие removed: ловим сам факт исчезновения.
  // Фокус ставим на имя карточки, вставшей на её место (в сетке — соседняя, а не первая),
  // или на заголовок страницы, если карточек не осталось.
  private watchFocusedCard(list: FeedItem[]): void {
    const uids = list.map((item) => item.player.uid);
    const lost = this.focusedCardUid;
    const index = lost && !uids.includes(lost) ? this.previousUids.indexOf(lost) : -1;
    this.previousUids = uids;
    if (!lost || index < 0) {
      return;
    }
    this.focusedCardUid = null;
    const restore = () => {
      // Человек уже сам перевёл фокус куда-то — не отбираем.
      if (this.destroyed || !this.focusLost(lost)) {
        return;
      }
      const results = this.results();
      const next = results[Math.min(index, results.length - 1)];
      const id = next ? `player-${next.player.uid}-name` : 'feed-title';
      this.document.getElementById(id)?.focus();
    };
    // Окно подтверждения ещё открыто — закрываясь, Material вернёт фокус на «⋮», которого
    // уже нет. Ждём закрытия всех окон, а потом ещё один «тик» (setTimeout), чтобы Material
    // закончил своё, — и только тогда ставим фокус.
    if (this.dialog.openDialogs.length) {
      this.dialog.afterAllClosed.pipe(take(1)).subscribe(() => setTimeout(restore));
    } else {
      // afterNextRender — ждём, пока Angular обновит страницу и новая карточка окажется в DOM.
      afterNextRender(restore, { injector: this.injector });
    }
  }

  // Фокус «потерян»: он на <body>, на удалённом из DOM элементе или ещё внутри улетающей
  // карточки (animate.leave держит её в DOM, пока играет анимация).
  private focusLost(uid: string): boolean {
    const active = this.document.activeElement;
    return (
      !active ||
      active === this.document.body ||
      !active.isConnected ||
      !!active.closest(`app-player-card[data-uid="${uid}"]`)
    );
  }

  // Общий конец «Вернуть» для лайка и пропуска: карточка снова в ленте, и первой.
  private restoreCard(player: Player): void {
    this.heldByButton.set(null);
    this.swipeDirections.delete(player.uid);
    this.frontUid.set(player.uid);
    this.swiped.update((uids) => {
      const next = new Set(uids);
      next.delete(player.uid);
      return next;
    });
    // Пока шёл запрос (у пропуска), человек мог свайпнуть дальше — тогда строку
    // не перезаписываем и фокус у него не отбираем.
    if (this.lastAction()?.player.uid === player.uid) {
      this.lastAction.set({ kind: 'restored', player });
      this.announcement.set(this.lastActionText());
      this.focusCard(player.uid);
    }
  }

  private settle(): void {
    clearTimeout(this.settleTimer);
    this.settling.set(true);
    this.settleTimer = setTimeout(() => this.settling.set(false), SETTLE_MS);
  }

  // Нажатая кнопка исчезла вместе с карточкой — без этого фокус упал бы на <body>, и человеку
  // с клавиатуры пришлось бы заново проходить через шапку и фильтры.
  // Переводим фокус на заголовок карточки, вставшей на освободившееся место.
  private focusAfterSwipe(index: number): void {
    const list = this.results();
    const next = list[Math.min(Math.max(index, 0), list.length - 1)];
    if (next) {
      this.focusCard(next.player.uid);
    } else {
      afterNextRender(() => this.document.getElementById('feed-title')?.focus(), {
        injector: this.injector,
      });
    }
  }

  private focusCard(uid: string): void {
    // afterNextRender — ждём, пока Angular обновит страницу и карточка окажется в DOM.
    afterNextRender(() => this.document.getElementById(`player-${uid}-name`)?.focus(), {
      injector: this.injector,
    });
  }

  // Ошибка из двух целых предложений: что не получилось («Лайк не отправлен: Alex.»)
  // и почему / что делать («Сервер недоступен. Проверь подключение.»). Одно «нет сети»
  // без первой части не объясняло, какое действие пропало.
  private showError(failed: Direction | 'undo', player: Player, error: unknown): void {
    const what = this.i18n.translate(`feed.failed.${failed}`, { name: player.name });
    const why = this.i18n.translate(firestoreErrorKey(error));
    this.snackBar.open(`${what} ${why}`, undefined, { duration: 6000 });
  }

  // Мэтч случился, когда лента уже закрыта: короткое сообщение «Это мэтч: Alex!» с кнопкой
  // «Написать» — она открывает чат с этим игроком.
  private showMatchToast(player: Player, uid: string): void {
    this.snackBar
      .open(
        this.i18n.translate('feed.matchToast', { name: player.name }),
        this.i18n.translate('feed.matchAction'),
        { duration: 8000 },
      )
      .onAction()
      .subscribe(() => void this.router.navigate(['/chat', matchId(uid, player.uid)]));
  }

  // «Это мэтч!» — отдельное окно: два аватара и во что вы можете поиграть вместе.
  private showMatch(player: Player, uid: string): void {
    const me = this.me();
    if (!me) {
      return;
    }
    this.dialog
      .open<MatchDialog, MatchDialogData, MatchDialogResult>(MatchDialog, {
        data: { me, player, match: matchScore(me, player) },
        autoFocus: 'first-tabbable',
        panelClass: 'di-framed-dialog',
        maxWidth: '440px',
        width: 'calc(100vw - 32px)',
      })
      .afterClosed()
      .subscribe((result) => {
        if (result === 'chat') {
          void this.router.navigate(['/chat', matchId(uid, player.uid)]);
        } else if (result === 'contacts') {
          // Контакты мэтча показывает страница «Мэтчи» — там они и «открылись».
          void this.router.navigate(['/matches']);
        }
      });
  }

  // Фильтры из прошлого визита. Чужие или битые данные в localStorage просто игнорируем.
  private restoreFilters(): void {
    try {
      const saved = JSON.parse(readStorage(this.filtersKey) ?? 'null');
      if (saved && typeof saved === 'object') {
        this.filters.patchValue({
          game: typeof saved.game === 'string' ? saved.game : '',
          platform: PLATFORMS.includes(saved.platform) ? saved.platform : '',
          city: typeof saved.city === 'string' ? saved.city : '',
          minAge: Number.isFinite(saved.minAge) ? saved.minAge : MIN_AGE,
          maxAge: Number.isFinite(saved.maxAge) ? saved.maxAge : MAX_AGE,
        });
      }
    } catch {
      // Сломанный JSON — начинаем с чистых фильтров.
    }
  }

  protected dismissHint(): void {
    this.hintDismissed.set(true);
    writeStorage(this.hintKey, '1');
  }

  private get hintKey(): string {
    return `di-feed-hint-dismissed:${this.uid}`;
  }

  private get consentKey(): string {
    return `di-feed-consent-seen:${this.uid}`;
  }

  private get filtersKey(): string {
    return `${STORAGE.filters}:${this.uid}`;
  }

  // Страница закрыта authGuard, поэтому пользователь здесь всегда есть.
  private get uid(): string {
    return this.auth.user()!.uid;
  }

  private async load(): Promise<void> {
    const uid = this.uid;
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      // Свой профиль, чужие анкеты и мои прошлые лайки/пропуски грузим параллельно.
      const [{ profile }, players, swiped] = await Promise.all([
        this.profiles.load(uid),
        this.profiles.listPlayers(uid),
        this.swipes.swipedUids(uid),
      ]);
      this.me.set(profile);
      this.players.set(players);
      this.swiped.set(swiped);
      // Сохранённая игра из прошлого визита могла исчезнуть из анкет — тогда фильтр по ней
      // молча показывал бы пустоту. Сбрасываем.
      const { mine, others } = this.gameOptions();
      const game = this.filters.controls.game.value;
      if (game && !mine.includes(game) && !others.includes(game)) {
        this.filters.controls.game.setValue('');
      }
    } catch (error) {
      this.errorKey.set(firestoreErrorKey(error));
    } finally {
      this.loading.set(false);
    }
  }
}

// Обещание, которое «сдаётся» через ms миллисекунд с той же ошибкой, что Firestore даёт
// при долгом ответе (deadline-exceeded) — тогда пользователь увидит «нет соединения».
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new FirebaseError('deadline-exceeded', 'timeout')), ms),
    ),
  ]);
}

function clampAge(age: number): number {
  return Math.min(MAX_AGE, Math.max(MIN_AGE, age));
}

// localStorage может быть недоступен (приватный режим) — тогда просто не запоминаем.
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Не получилось запомнить — не страшно.
  }
}
