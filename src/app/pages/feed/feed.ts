import {
  Component,
  DOCUMENT,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
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
import { AuthService } from '../../core/auth/auth';
import { firestoreErrorKey } from '../../core/firebase/firestore-errors';
import { I18n } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { MatchInfo, matchScore } from '../../core/matching/match-score';
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

// Последнее действие — строка под колодой: «Приглашение отправлено: Alex» или «Пропущено: Alex · Вернуть».
// Это и подтверждение (особенно когда анимации выключены), и место для отмены пропуска.
interface LastAction {
  kind: 'liked' | 'skipped' | 'restored';
  player: Player;
  // Первый лайк на этом аккаунте — под строкой объясняем, что контакты пока скрыты.
  consentNote?: boolean;
}

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
    TranslatePipe,
    PlayerCard,
    ErrorState,
    StateMessage,
  ],
  templateUrl: './feed.html',
  styleUrl: './feed.scss',
  // Стрелки ← / → в режиме «по одному» — пропустить / лайкнуть.
  host: { '(document:keydown)': 'onKeydown($event)' },
})
export class Feed {
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(ProfileService);
  private readonly swipes = inject(SwipeService);
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
    const text = this.i18n.translate(`feed.last.${last.kind}`, { name: last.player.name });
    // Два целых предложения, а не склейка обрывков — так переводчику проще и порядок слов свой.
    return last.consentNote ? `${text}. ${this.i18n.translate('feed.last.consent')}` : text;
  });

  // Ещё не просмотренные игроки — только их и показываем.
  // Заблокированные (в любую сторону) пропадают сразу: hidden обновляется в реальном времени.
  protected readonly remaining = computed(() => {
    const hidden = this.notifications.hidden();
    return this.players().filter(
      (player) => !this.swiped().has(player.uid) && !hidden.has(player.uid),
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
      .sort((a, b) => Number(b.likedMe) - Number(a.likedMe) || b.match.percent - a.match.percent);
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
    });
    void this.load();
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
    this.view.set(view);
    writeStorage(STORAGE.view, view);
  }

  protected copyInvite(): void {
    this.clipboard.copy(this.document.location.origin);
    this.snackBar.open(this.i18n.translate('feed.inviteCopied'), undefined, { duration: 4000 });
  }

  protected like(player: Player): void {
    this.swipe(player, 'like', async () => {
      const matched = await this.swipes.like(this.uid, player.uid);
      if (matched) {
        this.showMatch(player);
      }
    });
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
      await withTimeout(this.swipes.unskip(this.uid, player.uid), UNDO_TIMEOUT_MS);
      this.swipeDirections.delete(player.uid);
      this.swiped.update((uids) => {
        const next = new Set(uids);
        next.delete(player.uid);
        return next;
      });
      // Пока шёл запрос, человек мог свайпнуть дальше — тогда строку не перезаписываем
      // и фокус у него не отбираем.
      if (this.lastAction()?.player.uid === player.uid) {
        this.lastAction.set({ kind: 'restored', player });
        this.announcement.set(this.lastActionText());
        this.focusCard(player.uid);
      }
    } catch (error) {
      this.showError('undo', player, error);
    } finally {
      this.restoring.set(null);
    }
  }

  // Игрока убрали через «⋮» (заблокировали). Карточка исчезнет, а с ней — фокус из меню.
  protected onRemoved(player: Player): void {
    const index = this.results().findIndex((item) => item.player.uid === player.uid);
    this.focusAfterSwipe(index, player.uid);
  }

  // ← пропустить, → лайкнуть. Только в колоде и только когда фокус «на колоде»: на самой
  // странице, на карточке или её кнопках. Стрелка на ссылке в шапке или в поле ввода — не наша.
  protected onKeydown(event: KeyboardEvent): void {
    const current = this.current();
    const target = event.target as HTMLElement | null;
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
  private swipe(player: Player, direction: Direction, action: () => Promise<void>): void {
    if (this.settling() || this.swiped().has(player.uid)) {
      return;
    }
    const index = this.results().findIndex((item) => item.player.uid === player.uid);
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
      writeStorage(this.consentKey, '1');
    }
    this.lastAction.set({ kind: direction === 'like' ? 'liked' : 'skipped', player, consentNote });
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
        writeStorage(this.consentKey, '0');
      }
      if (this.lastAction()?.player.uid === player.uid) {
        this.lastAction.set(null);
      }
      this.showError(direction, player, error);
    });
  }

  private settle(): void {
    clearTimeout(this.settleTimer);
    this.settling.set(true);
    this.settleTimer = setTimeout(() => this.settling.set(false), SETTLE_MS);
  }

  // Нажатая кнопка исчезла вместе с карточкой — без этого фокус упал бы на <body>, и человеку
  // с клавиатуры пришлось бы заново проходить через шапку и фильтры.
  // Переводим фокус на заголовок карточки, вставшей на освободившееся место.
  // exclude — uid карточки, которая вот-вот пропадёт, но ещё есть в results (блокировка).
  private focusAfterSwipe(index: number, exclude?: string): void {
    const list = this.results().filter((item) => item.player.uid !== exclude);
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

  // «Это мэтч!» — отдельное окно: два аватара и во что вы можете поиграть вместе.
  private showMatch(player: Player): void {
    const me = this.me();
    if (!me) {
      return;
    }
    this.dialog
      .open<MatchDialog, MatchDialogData, MatchDialogResult>(MatchDialog, {
        data: { me, player, match: matchScore(me, player) },
        autoFocus: 'first-tabbable',
        panelClass: 'di-match-dialog',
        maxWidth: '440px',
        width: 'calc(100vw - 32px)',
      })
      .afterClosed()
      .subscribe((result) => {
        if (result === 'chat') {
          void this.router.navigate(['/chat', matchId(this.uid, player.uid)]);
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
