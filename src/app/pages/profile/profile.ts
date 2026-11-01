import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth';
import { firestoreErrorKey } from '../../core/firebase/firestore-errors';
import { confirmLeave } from '../../core/guards/leave-dialog';
import { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import { I18n } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { NetworkTimeoutError, withNetworkTimeout } from '../../core/profile/network-timeout';
import { PlatformConnect } from '../../core/profile/platform-connect';
import { ProfileService } from '../../core/profile/profile';
import {
  CONTACT_FIELDS,
  ContactField,
  CONTACT_SITES,
  GENRES,
  Genre,
  PLATFORMS,
  PLAY_TIMES,
  Platform,
  PlayTime,
  MIN_CUSTOM_GAME_LENGTH,
  POPULAR_GAMES,
  UserContacts,
  ageFrom,
  catalogGame,
  gameKey,
  isProfileLink,
  isValidContact,
} from '../../core/profile/profile.model';
import { resizeImage } from '../../core/profile/resize-image';
import { MatchInfo } from '../../core/matching/match-score';
import { PlayerCard } from '../feed/player-card/player-card';
import { initialOf } from '../../shared/initial';
import { ErrorState } from '../../shared/error-state/error-state';

const MIN_AGE = 18;
// Метка «анкету создали только что, а человек ушёл подключать Steam/Discord».
// После возврата страница загружается заново и про первый заход уже ничего не помнит —
// по этой метке она покажет кнопку «К анкетам», чтобы путь в ленту не терялся.
const FIRST_RUN_KEY = 'di-profile-first-run';
const MAX_PHOTO_FILE_SIZE = 15 * 1024 * 1024; // 15 МБ — больше не тянем в браузер даже для сжатия

// Валидатор даты рождения: младше 18 — ошибка underage. Пустое поле проверяет Validators.required.
function adultValidator(control: AbstractControl<string>): ValidationErrors | null {
  return control.value && ageFrom(control.value) < MIN_AGE ? { underage: true } : null;
}

// Валидатор-«фабрика»: возвращает валидатор, который знает, на какие сайты можно ссылаться.
// Годится ник, ссылка на один из domains или пустое поле.
function contactValidator(domains: readonly string[]) {
  return (control: AbstractControl<string>): ValidationErrors | null =>
    isValidContact(control.value.trim(), domains) ? null : { contact: true };
}

// Поля формы в том порядке, в каком они стоят на странице, и ключи их подписей.
// По этому списку ищем ПЕРВОЕ поле с ошибкой (на него уйдёт фокус) и собираем текст «Поправь поля: Город, Платформы».
// Путь 'contacts.discord' — вложенное поле: form.get() понимает такие пути через точку.
const FIELD_LABELS: readonly (readonly [path: string, labelKey: string])[] = [
  ['games', 'profile.games.label'],
  ['platforms', 'profile.platforms'],
  ['genres', 'profile.genres'],
  ['playTimes', 'profile.playTimes'],
  ['name', 'profile.name'],
  ['birthDate', 'profile.birthDate'],
  ['city', 'profile.city'],
  ['bio', 'profile.bio'],
  ...CONTACT_FIELDS.map((field) => [`contacts.${field}`, `profile.contacts.${field}`] as const),
];

// Дата N лет назад в формате 'YYYY-MM-DD' — ограничение max для календаря.
function yearsAgo(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// С этой ширины (вся колонка страницы, 960px) рядом с формой помещается превью карточки шириной
// как в сетке ленты. Уже — форма осталась бы узкой, и превью открывается кнопкой над ней.
const WIDE_PREVIEW_QUERY = '(min-width: 960px)';

@Component({
  selector: 'app-profile',
  imports: [
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    RouterLink,
    TranslatePipe,
    ErrorState,
    PlayerCard,
  ],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
  host: {
    // beforeunload — событие браузера перед закрытием вкладки или перезагрузкой.
    // Роутер (и наш canDeactivate guard) про такой уход не знает, поэтому ловим его здесь.
    '(window:beforeunload)': 'onBeforeUnload($event)',
    // Ctrl+S / Cmd+S — привычное «сохранить» из редакторов. Слушаем на document: фокус может быть
    // где угодно (в поле, на чипе, на кнопке панели), а не только внутри нашего элемента.
    '(document:keydown)': 'onSaveShortcut($event)',
  },
})
export class Profile implements HasUnsavedChanges {
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(ProfileService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18n);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  // window через DOCUMENT, а не глобальной переменной, — так принято в Angular (и так проще подменить в тестах).
  private readonly window = inject(DOCUMENT).defaultView!;
  protected readonly connect = inject(PlatformConnect);

  protected readonly maxGames = 20;
  protected readonly maxBioLength = 500;
  protected readonly maxBirthDate = yearsAgo(MIN_AGE);
  protected readonly contactFields = CONTACT_FIELDS;
  protected readonly contactSites = CONTACT_SITES;
  protected readonly isProfileLink = isProfileLink;

  // Три группы «чипов» выглядят одинаково, поэтому выводим их одним @for.
  // control — имя поля формы, и оно же — раздел переводов profile.<control> и catalog.<control>.
  protected readonly chipGroups = [
    { control: 'platforms', options: PLATFORMS },
    { control: 'genres', options: GENRES },
    { control: 'playTimes', options: PLAY_TIMES },
  ] as const;
  // Ссылка на сам валидатор — чтобы шаблон спросил у поля «ты обязательное?» (hasValidator),
  // а не держал второй, ручной список обязательных групп, который легко разойдётся с формой ниже.
  protected readonly requiredValidator = Validators.required;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  // Ошибка ЗАГРУЗКИ — отдельно от ошибки сохранения. Если анкета не загрузилась, форму не показываем:
  // иначе пустая форма и «Зберегти» затёрли бы настоящий профиль.
  protected readonly loadErrorKey = signal<string | null>(null);
  // Строки-заготовки скелетона: ширина полей формы (в %).
  protected readonly skeletonChipRows = [80, 95, 60];
  protected readonly skeletonFields = [100, 70, 100, 85];
  protected readonly photo = signal<string | null>(null);
  protected readonly photoErrorKey = signal<string | null>(null);
  protected readonly gameQuery = signal('');
  // Превью «как меня видят» стоит сбоку от формы, только когда рядом есть место (WIDE_PREVIEW_QUERY).
  // Уже — превью открывается кнопкой над формой. Две карточки сразу не рисуем: у заголовка карточки есть id.
  private readonly widePreviewMedia = this.window.matchMedia(WIDE_PREVIEW_QUERY);
  protected readonly widePreview = signal(this.widePreviewMedia.matches);
  protected readonly previewOpen = signal(false);
  // Показать ВЕСЬ список популярных игр при пустом поле. Только по явной просьбе — стрелке вниз.
  // Просто фокус (Tab, клик, переход из списка ошибок) список не открывает: он закрыл бы
  // текст ошибки под полем и группу «Платформы», а диктор прочитал бы список вместо ошибки.
  protected readonly browseGames = signal(false);
  // В поле даты начали вводить, но не дописали: value ещё пустой, а цифры на экране уже есть.
  // Тогда маску «дд.мм.гггг» не прячем — иначе недописанные цифры исчезли бы (см. profile.html).
  protected readonly birthDatePartial = signal(false);
  // Первый заход: анкеты в базе ещё нет. Тогда страница — «собери профиль», а после сохранения ведём в ленту.
  protected readonly isNew = signal(false);
  // Анкету только что создали, но в ленту сами не увели (вернулись со Steam/Discord, не было сети,
  // правили во время сохранения) — тогда в панели внизу появляется кнопка «К анкетам».
  protected readonly readyForFeed = signal(false);
  // Сеть не ответила, и запись ждёт в очереди Firestore на этом устройстве. Пока она не дошла,
  // закрывать вкладку молча нельзя: очередь живёт в памяти вкладки и пропадёт вместе с ней.
  // protected — по нему шаблон пишет «Сохранено на устройстве» вместо «Все изменения сохранены».
  protected readonly pendingSync = signal(false);
  // Не ошибка, а состояние: «сохранено на устройстве, отправится, когда вернётся связь».
  // Показываем под кнопкой и озвучиваем вежливо (role="status"), а не тревожно, как ошибку.
  protected readonly statusKey = signal<string | null>(null);
  // Человек уже пытался сохранить форму с ошибками — с этого момента показываем список полей, которые надо поправить.
  protected readonly showInvalid = signal(false);
  // Почему не добавилась набранная игра (дубль или уже 20 штук). Показываем под полем, пока человек не начнёт печатать снова.
  protected readonly gameRejection = signal<{ key: string; game: string } | null>(null);
  // Текст для диктора после неудачной отправки — снимок списка полей с ошибками на момент нажатия.
  // Видимый список под кнопкой обновляется молча, по мере исправления полей; а этот текст
  // меняется только при «Сохранить», поэтому role="alert" прочитает его один раз, а не на каждое исправление.
  protected readonly invalidAnnouncement = signal('');
  // Уходим на сайт Steam/Discord после подтверждения — второй раз (в beforeunload) не спрашиваем.
  private leavingForConnect = false;
  // Страницу уже закрыли (например, ушли с неё посреди сохранения) — тогда никуда не уводим и фокус не трогаем.
  private destroyed = false;
  // viewChild — signal со ссылкой на элемент шаблона с меткой #gameInput (поле ввода игр).
  // Нужен save(): дописать игру, которую набрали, но не подтвердили Enter.
  private readonly gameInput = viewChild<ElementRef<HTMLInputElement>>('gameInput');

  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(30)]],
    birthDate: ['', [Validators.required, adultValidator]],
    city: ['', [Validators.required, Validators.maxLength(50)]],
    bio: ['', Validators.maxLength(this.maxBioLength)],
    // Для массива Validators.required означает «хотя бы один элемент».
    games: [[] as string[], Validators.required],
    platforms: [[] as Platform[], Validators.required],
    genres: [[] as Genre[], Validators.required],
    playTimes: [[] as PlayTime[]],
    contacts: this.fb.group({
      discord: ['', contactValidator(CONTACT_SITES.discord.domains)],
      steam: ['', contactValidator(CONTACT_SITES.steam.domains)],
      psn: ['', contactValidator(CONTACT_SITES.psn.domains)],
      xbox: ['', contactValidator(CONTACT_SITES.xbox.domains)],
    }),
  });

  // toSignal превращает поток изменений формы в signal — от него считаются подсказки ниже.
  protected readonly games = toSignal(this.form.controls.games.valueChanges, {
    initialValue: this.form.controls.games.value,
  });

  // form.events — поток ВСЕХ событий формы: смена значения, статуса, touched, dirty/pristine.
  // Сама форма не signal, поэтому computed ниже не узнал бы, что значение или статус поменялись.
  // Читая formEvent(), computed подписывается на этот поток и пересчитывается после каждого события.
  private readonly formEvent = toSignal(this.form.events);

  // «Снимок» анкеты, которая сейчас лежит в базе: строка JSON из значений формы и фото.
  // Ставим его после загрузки и после каждого сохранения. null — снимка ещё нет (анкета грузится).
  private readonly savedSnapshot = signal<string | null>(null);

  // Тот же снимок, но для того, что сейчас на экране. Пересчитывается на каждое событие формы и смену фото.
  private readonly currentSnapshot = computed(() => {
    this.formEvent();
    return this.snapshot();
  });

  // Есть несохранённые правки — от этого зависят значок «не сохранено», кнопка «Сохранить» и guard ухода.
  // Сравниваем ЗНАЧЕНИЯ, а не флаг form.dirty. dirty — это «поле трогали», а не «значение другое»:
  // его ставит, например, список чипов игр, когда фокус просто прошёл через поле, и он не снимается,
  // если человек вернул всё как было. Сравнение снимков честнее: стёр правку — снова «всё сохранено».
  protected readonly dirty = computed(() => {
    const saved = this.savedSnapshot();
    return saved !== null && this.currentSnapshot() !== saved;
  });

  // Поля с ошибками, в порядке страницы: путь (по нему ищем элемент для фокуса) и подпись ('Город').
  // Подписи идут списком после двоеточия, поэтому падеж не важен — в любом языке это просто перечень.
  protected readonly invalidFields = computed(() => {
    this.formEvent();
    this.i18n.lang(); // сменили язык — пересобираем подписи на новом
    return FIELD_LABELS.filter(([path]) => this.form.get(path)?.invalid).map(([path, key]) => ({
      path,
      label: this.i18n.translate(key),
    }));
  });

  // Текст «Поправь поля (3): …» вокруг списка-кнопок. Переводим его с меткой вместо списка и режем
  // по метке: before — всё до списка, after — после. Так каждое имя поля в шаблоне — своя кнопка,
  // а порядок слов (вдруг в каком-то языке список стоит не в конце) по-прежнему решает перевод.
  protected readonly fixFieldsText = computed(() => {
    const marker = '\u0000';
    const text = this.i18n.translate('profile.errors.fixFields', {
      count: this.invalidFields().length,
      fields: marker,
    });
    const [before, after = ''] = text.split(marker);
    return { before, after };
  });

  // Кнопку «Сохранить» гасим, пока нечего сохранять. Исключение — первый заход:
  // даже нетронутую форму можно отправить, тогда появится список того, что нужно заполнить.
  protected readonly saveDisabled = computed(
    () => this.saving() || (!this.isNew() && !this.dirty()),
  );

  // Сохранять нечего и ничего не сохраняется — вместо погасшей кнопки показываем тихое «всё сохранено».
  // Это saveDisabled без «идёт сохранение»: у сохранения свой вид («Сохраняем…»).
  protected readonly allSaved = computed(() => !this.saving() && !this.isNew() && !this.dirty());

  // Сохранять нечего и сказать нечего — на телефоне панель тогда не липкая (см. .idle в profile.scss).
  protected readonly barIdle = computed(
    () =>
      this.allSaved() &&
      !this.readyForFeed() &&
      !this.showInvalid() &&
      !this.errorKey() &&
      !this.statusKey(),
  );

  // Подпись кнопки «Сохранить» для каждого её вида (сами виды описаны в profile.html).
  protected readonly saveLabelKey = computed(() => {
    if (this.allSaved()) {
      return this.pendingSync() ? 'profile.savedOnDevice' : 'profile.allSaved';
    }
    if (this.saving()) {
      return 'profile.saving';
    }
    return this.isNew() ? 'profile.firstRun.save' : 'profile.save';
  });

  // Подсказки: популярные игры, которые подходят под набранный текст и ещё не выбраны.
  // Пустое поле и стрелку вниз не нажимали — подсказок нет. Пустой mat-autocomplete панель
  // не показывает вовсе, даже если фокус пришёл в поле: так список не всплывает «сам».
  // Сокращение из каталога («cs2», «wow») поднимает свою игру в начало списка.
  protected readonly suggestions = computed(() => {
    const query = this.gameQuery().trim().toLowerCase();
    if (!query && !this.browseGames()) {
      return [];
    }
    const chosen = new Set(this.games().map(gameKey));
    const alias = catalogGame(query);
    // Сначала игры, где набранное — начало слова («ov» → Overwatch 2), потом совпадения
    // посреди слова (Escape from Tarkov): люди печатают название с начала.
    const wordStart = (game: string) =>
      game
        .toLowerCase()
        .split(/[\s:-]+/)
        .some((word) => word.startsWith(query));
    const matches = POPULAR_GAMES.filter(
      (game) => game !== alias && game.toLowerCase().includes(query),
    ).sort((a, b) => Number(wordStart(b)) - Number(wordStart(a)));
    return (alias ? [alias, ...matches] : matches).filter((game) => !chosen.has(gameKey(game)));
  });

  // Уже выбранные игры, которые подходят под набранное, — неактивными строками «… · уже в списке».
  // Без них «ow2» при добавленной Overwatch 2 давал пустой список, и было непонятно, почему.
  protected readonly alreadyAdded = computed(() => {
    const query = this.gameQuery().trim().toLowerCase();
    if (!query) {
      return [];
    }
    const alias = catalogGame(query);
    return this.games().filter(
      (game) => gameKey(game) === gameKey(alias ?? query) || game.toLowerCase().includes(query),
    );
  });

  // Последний пункт подсказок — «Добавить „…“»: набранное своё название, которого нет в каталоге.
  // Так видно заранее, что игра добавится как своя, а не исправится в каталожную.
  // Пока набранное — кусок названия из каталога или из уже добавленных («Ove», «hollow»), это
  // почти наверняка недописанное имя, а не своя игра: строку «Добавить „Ove“» не предлагаем.
  protected readonly customGame = computed(() => {
    const name = this.gameQuery().trim().replace(/\s+/g, ' ');
    const lower = name.toLowerCase();
    const known = [...POPULAR_GAMES, ...this.games()];
    return name.length >= MIN_CUSTOM_GAME_LENGTH &&
      !catalogGame(name) &&
      !known.some((game) => game.toLowerCase().includes(lower))
      ? name
      : null;
  });

  // Карточка из ленты, собранная из того, что сейчас в форме, — видно, как анкета выглядит для других,
  // ещё до сохранения. Своих совпадений с собой нет, поэтому все игры идут под подписью «Игры».
  protected readonly previewPlayer = computed(() => {
    this.formEvent();
    // Контакты в карточку не берём: в ленте их не видно до взаимного лайка.
    const { name, birthDate, city, bio, games, platforms, genres, playTimes } =
      this.form.getRawValue();
    return {
      uid: 'preview',
      name: name.trim() || this.i18n.translate('profile.preview.noName'),
      birthDate,
      city: city.trim(),
      bio: bio.trim(),
      photo: this.photo(),
      games,
      platforms,
      genres,
      playTimes,
    };
  });
  // Первая буква имени для монограммы в пустом слоте фото (см. shared/initial.ts).
  protected readonly initial = computed(() => {
    this.formEvent();
    return initialOf(this.form.controls.name.value, this.i18n.lang());
  });
  protected readonly previewAge = computed(() => {
    const birthDate = this.previewPlayer().birthDate;
    return birthDate ? ageFrom(birthDate) : null;
  });
  // Превью показывает карточку глазами игрока, у которого с тобой общая первая игра и платформа.
  // Совпадение — главное, что делает карточку живой в ленте: общее светится бирюзовым и стоит
  // первым. С пустым совпадением превью было серым и не показывало, ради чего заполнять анкету.
  // Процент не придумываем (0 — метка скрыта), над карточкой сказано, для кого этот вид.
  protected readonly previewMatch = computed<MatchInfo>(() => {
    const { games, platforms } = this.previewPlayer();
    return {
      percent: 0,
      commonGames: games.slice(0, 1),
      commonPlatforms: platforms.slice(0, 1),
      commonGenres: [],
      commonPlayTimes: [],
    };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    const onWidthChange = (event: MediaQueryListEvent) => this.widePreview.set(event.matches);
    this.widePreviewMedia.addEventListener('change', onWidthChange);
    inject(DestroyRef).onDestroy(() =>
      this.widePreviewMedia.removeEventListener('change', onWidthChange),
    );
    // Любая правка — новая попытка: старые сообщения об ошибке («не удалось подключить», «нет сети»)
    // и текст для диктора уже не про то, что сейчас в форме. takeUntilDestroyed отпишется, когда страницу закроют.
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.errorKey.set(null);
      this.invalidAnnouncement.set('');
    });
    void this.load();
  }

  protected addGame(value: string, input: HTMLInputElement): void {
    const typed = value.trim().replace(/\s+/g, ' ');
    if (!typed) {
      return;
    }
    // «cs2» сохраняем как «Counter-Strike 2»: так игра совпадёт с теми, кто выбрал её из списка.
    const name = catalogGame(typed) ?? typed;
    const games = this.form.controls.games.value;
    const duplicate = games.find((game) => gameKey(game) === gameKey(name));
    if (name === typed && typed.length < MIN_CUSTOM_GAME_LENGTH) {
      // «Ha» — скорее недописанное название, чем игра. Текст оставляем в поле: допишут или выберут из списка.
      this.gameRejection.set({ key: 'profile.games.tooShort', game: typed });
      return;
    } else if (duplicate) {
      // Такая игра уже есть — набранное стираем (оно ничего не добавит) и говорим почему.
      this.gameRejection.set({ key: 'profile.games.duplicate', game: duplicate });
    } else if (games.length >= this.maxGames) {
      // Лимит: текст в поле оставляем — уберёт одну игру и добавит эту, не набирая заново.
      this.gameRejection.set({ key: 'profile.games.limit', game: name });
      return;
    } else {
      this.form.controls.games.setValue([...games, name]);
      this.gameRejection.set(null);
    }
    input.value = '';
    this.gameQuery.set('');
    this.browseGames.set(false);
  }

  // Набрали в поле игр текст и сразу нажали «Сохранить» (или Enter в другом поле) — не теряем его.
  private flushGameInput(): void {
    const input = this.gameInput()?.nativeElement;
    if (input?.value.trim()) {
      this.addGame(input.value, input);
    }
  }

  protected onGameTyped(value: string): void {
    this.gameQuery.set(value);
    this.gameRejection.set(null);
  }

  // Стрелка вниз в пустом поле — явная просьба «покажи, из чего выбрать». Включаем полный список;
  // саму панель откроет mat-autocomplete (он тоже слушает стрелки), как только в ней появятся пункты.
  protected browseAllGames(): void {
    this.browseGames.set(true);
  }

  // Панель закрылась (Esc, ушли из поля, выбрали игру) — при следующем фокусе списка снова нет.
  protected stopBrowsingGames(): void {
    this.browseGames.set(false);
  }

  protected removeGame(name: string): void {
    this.form.controls.games.setValue(
      this.form.controls.games.value.filter((game) => game !== name),
    );
  }

  protected async onPhotoSelected(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = ''; // чтобы можно было снова выбрать тот же файл
    if (!file) {
      return;
    }
    this.photoErrorKey.set(null);
    if (file.size > MAX_PHOTO_FILE_SIZE) {
      this.photoErrorKey.set('profile.photo.tooBig');
      return;
    }
    try {
      // Фото — signal, и он входит в снимок (currentSnapshot), так что «не сохранено» загорится само.
      this.photo.set(await resizeImage(file));
    } catch {
      this.photoErrorKey.set('profile.photo.invalid');
    }
  }

  protected removePhoto(): void {
    this.photo.set(null);
  }

  // Для guard'а и beforeunload. Пока идёт сохранение, правки тоже считаем несохранёнными:
  // ответа сервера ещё нет, и при плохой сети запись может не дойти — молча отпускать нельзя.
  hasUnsavedChanges(): boolean {
    return this.dirty() || this.saving();
  }

  // Внутри приложения запись из очереди Firestore не пропадёт (база живёт, пока открыта вкладка),
  // поэтому guard про неё не спрашивает. А вот закрытие вкладки очередь стирает — тут предупреждаем.
  // preventDefault() просит браузер показать своё окно «Покинуть сайт?». Текст окна задаёт сам браузер.
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if ((this.hasUnsavedChanges() || this.pendingSync()) && !this.leavingForConnect) {
      event.preventDefault();
    }
  }

  // Ctrl+S (Cmd+S на Mac) сохраняет анкету, когда есть что сохранять. Тогда preventDefault
  // отменяет окно браузера «Сохранить страницу как…»: оно тут явно не то, чего хотели.
  // Нечего сохранять — клавиши не трогаем, браузер ведёт себя как обычно.
  protected onSaveShortcut(event: KeyboardEvent): void {
    const isSaveKeys =
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      // code — физическая клавиша: на русской или украинской раскладке key был бы «ы» / «і»,
      // а браузер своё «Сохранить страницу» всё равно открывает по этой клавише.
      (event.code === 'KeyS' || event.key.toLowerCase() === 's');
    // Пока анкета грузится (или не загрузилась), формы на экране нет — сохранять нечего.
    // Открытый диалог (например, «уйти без сохранения?») — не время сохранять из-под него.
    if (!isSaveKeys || this.loading() || this.loadErrorKey() || this.dialog.openDialogs.length) {
      return;
    }
    // Набранная, но не подтверждённая Enter игра — тоже правка: сначала превращаем её в чип.
    this.flushGameInput();
    if (!this.hasUnsavedChanges() && !this.isNew()) {
      return;
    }
    event.preventDefault();
    // Держим клавиши — браузер шлёт keydown повторно; второе сохранение подряд не нужно.
    if (!event.repeat) {
      void this.save();
    }
  }

  protected async save(): Promise<void> {
    // У кнопки disabledInteractive: «погасшая», она остаётся в фокусе и её можно нажать —
    // поэтому проверяем здесь. Это же ловит Enter в поле, пока прошлое сохранение ещё в пути.
    if (this.saveDisabled()) {
      return;
    }
    this.flushGameInput();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorKey.set(null);
      this.showInvalid.set(true);
      this.announceInvalid();
      this.focusFirstInvalid();
      return;
    }
    const wasNew = this.isNew();
    const result = await this.persist();
    if (!result) {
      return;
    }
    if (result === 'queued') {
      // Записали на устройство, но не на сервер. В ленту (её без сети не загрузить) не уводим —
      // объяснение уже под кнопкой, а путь в ленту оставляем кнопкой «К анкетам».
      if (wasNew) {
        this.readyForFeed.set(true);
      }
      return;
    }
    const saved = this.i18n.translate('profile.saved');
    if (this.destroyed) {
      // Пока шло сохранение, человек ушёл на другую страницу (guard его отпустил) —
      // не утаскиваем обратно в ленту, просто сообщаем, что анкета всё-таки сохранилась.
      this.snackBar.open(saved, undefined, { duration: 3000 });
      return;
    }
    // Во время сохранения могли что-то поправить — тогда форма осталась «грязной», и уводить
    // в ленту нельзя (guard спросил бы «уйти без сохранения?»). Остаёмся, как при обычном сохранении.
    if (wasNew && !this.dirty()) {
      // Анкета готова — сразу показываем то, ради чего её заполняли: ленту игроков.
      // Наградой будет сама лента, поэтому вместо сухого «Профиль сохранён» — короткая фраза о том,
      // что человек сейчас видит. Снекбар внизу, над панелью действий ленты (её отступ
      // задаёт styles.scss), так что первую карточку он не закрывает.
      this.snackBar.open(this.i18n.translate('profile.firstRun.welcome'), undefined, {
        duration: 4000,
      });
      await this.router.navigate(['/feed']);
      return;
    }
    if (wasNew) {
      this.readyForFeed.set(true); // правили во время сохранения — остались, но путь в ленту под рукой
    }
    this.keepFocus();
    // Об успехе говорит снекбар: он сам живая область (aria-live), диктор прочитает его, не трогая фокус.
    // onAction() срабатывает, когда нажали кнопку на самом снекбаре.
    this.snackBar
      .open(saved, this.i18n.translate('profile.toFeed'), this.barSnack(5000))
      .onAction()
      .subscribe(() => void this.router.navigate(['/feed']));
  }

  // Фокус после сохранения. Человек мог, не дожидаясь ответа, вернуться в поле и печатать дальше —
  // тогда фокус не трогаем вообще. «Сохранить» с disabledInteractive и погасшей остаётся в фокусе,
  // так что обычно делать ничего не нужно. Если же фокус всё-таки потерялся (ушёл на body),
  // ставим его на заголовок, но без прокрутки: экран не прыгает наверх от нижней панели.
  private keepFocus(): void {
    const doc = this.host.nativeElement.ownerDocument;
    if (!doc.activeElement || doc.activeElement === doc.body) {
      this.host.nativeElement.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    }
  }

  // Настройки снекбара с результатом действия на этой странице («Профиль сохранён», «Steam подключён»).
  // На широком экране он встаёт в строку липкой панели, слева (класс di-bar-snack, см. styles.scss),
  // а не над ней — иначе ложился бы на поля анкеты. Только когда метки «не сохранено» в панели нет
  // (форма чистая) — иначе снекбар закрыл бы её; и только пока страница открыта (панель на месте).
  // На телефоне панель занимает всю ширину — там снекбар как везде, над ней по центру.
  private barSnack(duration: number): MatSnackBarConfig {
    const inBar =
      !this.destroyed && !this.dirty() && this.window.matchMedia('(min-width: 601px)').matches;
    return inBar
      ? { duration, horizontalPosition: 'start', panelClass: 'di-bar-snack' }
      : { duration };
  }

  // Сама запись анкеты. Её зовут и «Сохранить», и «Подключить». Ответ:
  // 'saved'  — сервер подтвердил;
  // 'queued' — сеть не ответила, но Firestore держит запись в очереди и отправит её сам;
  // false    — сервер отказал (правила базы и т.п.), правки остаются несохранёнными.
  private async persist(): Promise<'saved' | 'queued' | false> {
    this.saving.set(true);
    this.errorKey.set(null);
    this.statusKey.set(null);
    this.showInvalid.set(false);
    // Снимок того, что отправили. Пока ждём сервер, человек может печатать дальше —
    // эти новые правки не должны пропасть. Поэтому «сохранённым» объявляем именно отправленное:
    // если на экране уже другое, dirty() останется true сам, без особых проверок.
    const submitted = this.form.getRawValue();
    const photo = this.photo();
    const snapshot = this.snapshot();
    const { contacts, ...profile } = submitted;
    try {
      await withNetworkTimeout(
        this.profiles.save(this.uid, { ...profile, photo }, this.trimmed(contacts)),
        this.window,
      );
      this.isNew.set(false); // анкета теперь есть в базе
      this.savedSnapshot.set(snapshot);
      return 'saved';
    } catch (error) {
      if (error instanceof NetworkTimeoutError) {
        // Честно: «не сохранилось» тут было бы неправдой. Запись лежит в очереди на устройстве —
        // для формы это «сохранено» (guard не пугает потерей), а pendingSync помнит,
        // что до сервера она ещё не дошла.
        this.isNew.set(false);
        this.savedSnapshot.set(snapshot);
        this.waitForSync(error.pending);
        return 'queued';
      }
      // Форма остаётся «грязной»: правки на месте, «Сохранить» активна — можно повторить.
      const key = firestoreErrorKey(error);
      if (this.destroyed) {
        // Страницу уже закрыли — сообщение под кнопкой никто не увидит, говорим снекбаром.
        this.snackBar.open(this.i18n.translate(key), undefined, { duration: 5000 });
      } else {
        this.errorKey.set(key);
      }
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  // Всё, что сохраняем в базу, одной строкой: значения формы и фото. Строки удобно сравнивать:
  // две равны, только если равны все поля, включая списки игр и чипов (и их порядок).
  private snapshot(): string {
    return JSON.stringify([this.form.getRawValue(), this.photo()]);
  }

  // Запись ушла в очередь Firestore. Показываем «сохранено на устройстве» и ждём, чем кончится:
  // дошла — говорим «связь вернулась, отправлено»; сервер отказал — снова зажигаем «Сохранить»,
  // чтобы правки не считались сохранёнными. Повторное сохранение просто встанет в очередь следом.
  private waitForSync(pending: Promise<unknown>): void {
    this.pendingSync.set(true);
    if (this.destroyed) {
      this.snackBar.open(this.i18n.translate('profile.queued'), undefined, { duration: 5000 });
    } else {
      this.statusKey.set('profile.queued');
    }
    pending.then(
      () => {
        this.pendingSync.set(false);
        // Снимаем сообщение, только если оно всё ещё наше (новое сохранение могло его сменить).
        if (this.statusKey() === 'profile.queued') {
          this.statusKey.set(null);
        }
        this.snackBar.open(this.i18n.translate('profile.synced'), undefined, this.barSnack(3000));
      },
      (error: unknown) => {
        console.error(error);
        this.pendingSync.set(false);
        this.statusKey.set(null);
        const key = firestoreErrorKey(error);
        if (this.destroyed) {
          this.snackBar.open(this.i18n.translate(key), undefined, { duration: 5000 });
          return;
        }
        // Правки до сервера не дошли — в базе их нет. Пустая строка не совпадёт ни с одним снимком,
        // поэтому dirty() станет true, и «Сохранить» снова загорится.
        this.savedSnapshot.set('');
        this.errorKey.set(key); // значения формы не менялись, так что подписка ошибку не сотрёт
      },
    );
  }

  // Уходим на сайт Steam/Discord, и страница перезагрузится. Чтобы анкета не пропала:
  // - есть что сохранять и всё заполнено верно — сначала сохраняем, потом уходим;
  // - есть ошибки — сохранить нельзя, поэтому предупреждаем тем же окном, что и guard.
  // На первом заходе (isNew) «сохранять» есть что, даже если ничего не трогали: имя из Google-аккаунта.
  protected async connectPlatform(field: ContactField): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.flushGameInput();
    // Первый заход: после возврата с платформы страница должна помнить, что дальше путь — в ленту.
    const firstRun = this.isNew() || this.readyForFeed();
    if ((this.dirty() || this.isNew()) && this.form.valid) {
      const result = await this.persist();
      if (!result) {
        return; // не сохранилось — остаёмся, ошибка уже под кнопкой
      }
      if (result === 'queued') {
        // Запись ждёт сеть в памяти этой вкладки — уход на Steam её бы стёр. Да и без сети туда не попасть.
        if (firstRun) {
          this.readyForFeed.set(true);
        }
        return;
      }
    }
    // Ещё грязная: либо ошибки в полях, либо что-то поправили, пока шло сохранение.
    if (this.dirty() && !(await confirmLeave(this.dialog, this.i18n))) {
      return;
    }
    this.leavingForConnect = true;
    try {
      if (firstRun) {
        rememberFirstRun(true);
      }
      this.connect.start(field);
    } catch (error) {
      // start() может упасть (например, браузер запретил sessionStorage) — тогда мы никуда не ушли,
      // и beforeunload снова должен защищать правки.
      console.error(error);
      this.leavingForConnect = false;
      rememberFirstRun(false);
      this.errorKey.set('profile.connect.failed');
    }
  }

  // Видимый список полей с ошибками обновляется молча; диктору — один снимок на каждое нажатие «Сохранить».
  // Если текст совпал с прошлым, role="alert" не заметил бы «изменения», поэтому сначала очищаем,
  // а новый текст ставим чуть позже, отдельным обновлением страницы.
  private announceInvalid(): void {
    const labels = this.invalidFields().map((field) => field.label);
    const text = this.i18n.translate('profile.errors.fixFields', {
      count: labels.length,
      fields: labels.join(', '),
    });
    this.invalidAnnouncement.set('');
    setTimeout(() => this.invalidAnnouncement.set(text), 100);
  }

  // Красная рамка видна не всем (а экранному диктору не видна совсем), поэтому после неудачной отправки
  // переводим фокус на первое поле с ошибкой: диктор прочитает его подпись и текст ошибки.
  // Нужные элементы помечены в шаблоне атрибутом data-field="путь поля".
  private focusFirstInvalid(): void {
    const first = FIELD_LABELS.find(([path]) => this.form.get(path)?.invalid);
    if (first) {
      this.focusField(first[0]);
    }
  }

  // Фокус в поле по его пути ('city', 'contacts.steam'). Зовут и «первое поле с ошибкой» после
  // неудачной отправки, и кнопки-имена полей в списке «Поправь поля: …» на панели внизу.
  protected focusField(path: string): void {
    const element = this.host.nativeElement.querySelector<HTMLElement>(`[data-field="${path}"]`);
    if (!element) {
      return;
    }
    // preventScroll + scrollIntoView: сами ставим поле в центр экрана, чтобы его не закрыла
    // липкая панель с кнопкой внизу. Список чипов (mat-chip-listbox) на focus() сам передаёт фокус чипу.
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'center' });
  }

  // Вернулись с платформы: подставляем ссылку и сразу сохраняем её, чтобы не пришлось жать «Сохранить».
  private async finishConnect(): Promise<void> {
    const contacts = this.form.controls.contacts;
    try {
      const result = await this.connect.finish();
      if (!result) {
        return;
      }
      contacts.controls[result.field].setValue(result.link);
      await withNetworkTimeout(
        this.profiles.saveContacts(this.uid, this.trimmed(contacts.getRawValue())),
        this.window,
      );
      // Ссылка теперь в базе — она часть «сохранённого» снимка.
      this.savedSnapshot.set(this.snapshot());
      const platform = this.i18n.translate(`profile.contacts.${result.field}`);
      this.snackBar.open(
        this.i18n.translate('profile.connect.done', { platform }),
        undefined,
        this.barSnack(3000),
      );
    } catch (error) {
      if (error instanceof NetworkTimeoutError) {
        // Ссылку получили, и она стоит в очереди на устройстве — это не «не удалось подключить».
        this.savedSnapshot.set(this.snapshot());
        this.waitForSync(error.pending);
        return;
      }
      console.error(error);
      // Если ссылку получили, а записать не смогли, — она стоит в поле, но не в сохранённом снимке.
      // Значит, dirty() уже true: «Сохранить» горит, ссылку можно сохранить вручную, не подключаясь заново.
      // Ошибку ставим ПОСЛЕ setValue: иначе подписка «любая правка стирает ошибку» сразу бы её убрала.
      this.errorKey.set('profile.connect.failed');
    }
  }

  // Убираем случайные пробелы вокруг скопированных ссылок.
  private trimmed(contacts: UserContacts): UserContacts {
    return {
      discord: contacts.discord.trim(),
      steam: contacts.steam.trim(),
      psn: contacts.psn.trim(),
      xbox: contacts.xbox.trim(),
    };
  }

  // Страница закрыта authGuard, поэтому пользователь здесь всегда есть.
  private get uid(): string {
    return this.auth.user()!.uid;
  }

  // Кнопка «Спробувати ще раз» на ошибке загрузки.
  protected retry(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadErrorKey.set(null);
    try {
      const { profile, contacts } = await this.profiles.load(this.uid);
      this.isNew.set(!profile);
      // Вернулись со Steam/Discord посреди первого захода — анкета уже есть, предлагаем ленту.
      // Метку снимаем сразу: при следующем открытии профиля это уже обычное редактирование.
      if (profile && rememberFirstRun(false)) {
        this.readyForFeed.set(true);
      }
      if (profile) {
        // patchValue заполняет только известные форме поля, лишние (updatedAt) пропускает.
        const { photo, ...fields } = profile;
        this.form.patchValue(fields);
        this.photo.set(photo ?? null);
      } else {
        // Профиля ещё нет — подставим имя из Google-аккаунта, если оно есть.
        this.form.controls.name.setValue(this.auth.user()?.displayName ?? '');
      }
      if (contacts) {
        this.form.controls.contacts.patchValue(contacts);
      }
      // То, что сейчас в форме, и есть «сохранённое» — от этого снимка считаем правки.
      // На первом заходе в базе пусто, но точкой отсчёта всё равно берём то, что показали
      // (имя из Google): ничего не тронул — уйти можно без вопроса.
      this.savedSnapshot.set(this.snapshot());
    } catch (error) {
      this.loadErrorKey.set(firestoreErrorKey(error));
      return;
    } finally {
      this.loading.set(false);
    }
    await this.finishConnect();
  }
}

// Метка первого захода в sessionStorage: живёт в этой вкладке и переживает уход на Steam и обратно.
// true — поставить, false — снять. Возвращает, была ли метка до вызова.
// try/catch: браузер может запретить хранилище (приватный режим, блокировка cookies) —
// тогда после возврата просто не будет кнопки «К анкетам», страница от этого не ломается.
function rememberFirstRun(on: boolean): boolean {
  try {
    const was = sessionStorage.getItem(FIRST_RUN_KEY) !== null;
    if (on) {
      sessionStorage.setItem(FIRST_RUN_KEY, '1');
    } else {
      sessionStorage.removeItem(FIRST_RUN_KEY);
    }
    return was;
  } catch {
    return false;
  }
}
