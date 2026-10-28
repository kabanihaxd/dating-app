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
import { MatSnackBar } from '@angular/material/snack-bar';
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
  POPULAR_GAMES,
  UserContacts,
  ageFrom,
  isProfileLink,
  isValidContact,
} from '../../core/profile/profile.model';
import { resizeImage } from '../../core/profile/resize-image';
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
  ['name', 'profile.name'],
  ['birthDate', 'profile.birthDate'],
  ['city', 'profile.city'],
  ['bio', 'profile.bio'],
  ['games', 'profile.games.label'],
  ['platforms', 'profile.platforms'],
  ['genres', 'profile.genres'],
  ['playTimes', 'profile.playTimes'],
  ...CONTACT_FIELDS.map((field) => [`contacts.${field}`, `profile.contacts.${field}`] as const),
];

// Дата N лет назад в формате 'YYYY-MM-DD' — ограничение max для календаря.
function yearsAgo(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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
  ],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
  host: {
    // beforeunload — событие браузера перед закрытием вкладки или перезагрузкой.
    // Роутер (и наш canDeactivate guard) про такой уход не знает, поэтому ловим его здесь.
    '(window:beforeunload)': 'onBeforeUnload($event)',
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
  protected readonly skeletonFields = [100, 100, 70, 100, 85];
  protected readonly photo = signal<string | null>(null);
  protected readonly photoErrorKey = signal<string | null>(null);
  protected readonly gameQuery = signal('');
  // Первый заход: анкеты в базе ещё нет. Тогда страница — «собери профиль», а после сохранения ведём в ленту.
  protected readonly isNew = signal(false);
  // Анкету только что создали, но в ленту сами не увели (вернулись со Steam/Discord, не было сети,
  // правили во время сохранения) — тогда в панели внизу появляется кнопка «К анкетам».
  protected readonly readyForFeed = signal(false);
  // Сеть не ответила, и запись ждёт в очереди Firestore на этом устройстве. Пока она не дошла,
  // закрывать вкладку молча нельзя: очередь живёт в памяти вкладки и пропадёт вместе с ней.
  private readonly pendingSync = signal(false);
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
  // Сама форма не signal, поэтому computed ниже не узнал бы о markAsDirty/markAsPristine.
  // Читая formEvent(), computed подписывается на этот поток и пересчитывается после каждого события.
  private readonly formEvent = toSignal(this.form.events);

  // Есть несохранённые правки — от этого зависят значок «не сохранено» и кнопка «Сохранить».
  protected readonly dirty = computed(() => {
    this.formEvent();
    return this.form.dirty;
  });

  // Подписи полей с ошибками, в порядке страницы: ['Город', 'Платформы'].
  // Подписи идут списком после двоеточия, поэтому падеж не важен — в любом языке это просто перечень.
  protected readonly invalidLabels = computed(() => {
    this.formEvent();
    this.i18n.lang(); // сменили язык — пересобираем подписи на новом
    return FIELD_LABELS.filter(([path]) => this.form.get(path)?.invalid).map(([, key]) =>
      this.i18n.translate(key),
    );
  });

  // Кнопку «Сохранить» гасим, пока нечего сохранять. Исключение — первый заход:
  // даже нетронутую форму можно отправить, тогда появится список того, что нужно заполнить.
  protected readonly saveDisabled = computed(
    () => this.saving() || (!this.isNew() && !this.dirty()),
  );

  // Подсказки: популярные игры, которые подходят под набранный текст и ещё не выбраны.
  protected readonly suggestions = computed(() => {
    const query = this.gameQuery().trim().toLowerCase();
    const chosen = new Set(this.games().map((game) => game.toLowerCase()));
    return POPULAR_GAMES.filter(
      (game) => !chosen.has(game.toLowerCase()) && game.toLowerCase().includes(query),
    );
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    // Любая правка — новая попытка: старые сообщения об ошибке («не удалось подключить», «нет сети»)
    // и текст для диктора уже не про то, что сейчас в форме. takeUntilDestroyed отпишется, когда страницу закроют.
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.errorKey.set(null);
      this.invalidAnnouncement.set('');
    });
    void this.load();
  }

  protected addGame(value: string, input: HTMLInputElement): void {
    const name = value.trim();
    if (!name) {
      return;
    }
    const games = this.form.controls.games.value;
    const duplicate = games.find((game) => game.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      // Такая игра уже есть — набранное стираем (оно ничего не добавит) и говорим почему.
      this.gameRejection.set({ key: 'profile.games.duplicate', game: duplicate });
    } else if (games.length >= this.maxGames) {
      // Лимит: текст в поле оставляем — уберёт одну игру и добавит эту, не набирая заново.
      this.gameRejection.set({ key: 'profile.games.limit', game: name });
      return;
    } else {
      this.form.controls.games.setValue([...games, name]);
      this.form.controls.games.markAsDirty();
      this.gameRejection.set(null);
    }
    input.value = '';
    this.gameQuery.set('');
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

  protected removeGame(name: string): void {
    this.form.controls.games.setValue(
      this.form.controls.games.value.filter((game) => game !== name),
    );
    this.form.controls.games.markAsDirty();
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
      this.photo.set(await resizeImage(file));
      this.form.markAsDirty();
    } catch {
      this.photoErrorKey.set('profile.photo.invalid');
    }
  }

  protected removePhoto(): void {
    this.photo.set(null);
    this.form.markAsDirty();
  }

  // Для guard'а и beforeunload. Пока идёт сохранение, правки тоже считаем несохранёнными:
  // ответа сервера ещё нет, и при плохой сети запись может не дойти — молча отпускать нельзя.
  hasUnsavedChanges(): boolean {
    return this.form.dirty || this.saving();
  }

  // Внутри приложения запись из очереди Firestore не пропадёт (база живёт, пока открыта вкладка),
  // поэтому guard про неё не спрашивает. А вот закрытие вкладки очередь стирает — тут предупреждаем.
  // preventDefault() просит браузер показать своё окно «Покинуть сайт?». Текст окна задаёт сам браузер.
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if ((this.hasUnsavedChanges() || this.pendingSync()) && !this.leavingForConnect) {
      event.preventDefault();
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
    if (wasNew && !this.form.dirty) {
      // Анкета готова — сразу показываем то, ради чего её заполняли: ленту игроков.
      this.snackBar.open(saved, undefined, { duration: 3000 });
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
      .open(saved, this.i18n.translate('profile.toFeed'), { duration: 5000 })
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
    // эти новые правки не должны пропасть, поэтому «всё сохранено» (pristine) ставим,
    // только если форма и фото не изменились с момента отправки.
    const submitted = this.form.getRawValue();
    const photo = this.photo();
    const snapshot = JSON.stringify([submitted, photo]);
    const { contacts, ...profile } = submitted;
    try {
      await withNetworkTimeout(
        this.profiles.save(this.uid, { ...profile, photo }, this.trimmed(contacts)),
        this.window,
      );
      this.isNew.set(false); // анкета теперь есть в базе
      this.markSavedIfUnchanged(snapshot);
      return 'saved';
    } catch (error) {
      if (error instanceof NetworkTimeoutError) {
        // Честно: «не сохранилось» тут было бы неправдой. Запись лежит в очереди на устройстве —
        // для формы это «сохранено» (pristine, guard не пугает потерей), а pendingSync помнит,
        // что до сервера она ещё не дошла.
        this.isNew.set(false);
        this.markSavedIfUnchanged(snapshot);
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

  // «Всё сохранено» (pristine) ставим, только если форма и фото не изменились с момента отправки.
  private markSavedIfUnchanged(snapshot: string): void {
    if (JSON.stringify([this.form.getRawValue(), this.photo()]) === snapshot) {
      this.form.markAsPristine();
    }
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
        this.snackBar.open(this.i18n.translate('profile.synced'), undefined, { duration: 3000 });
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
        this.form.markAsDirty(); // правки до сервера не дошли — «Сохранить» снова активна
        this.errorKey.set(key); // markAsDirty не меняет значения, так что подписка ошибку не сотрёт
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
    if ((this.form.dirty || this.isNew()) && this.form.valid) {
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
    if (this.form.dirty && !(await confirmLeave(this.dialog, this.i18n))) {
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
    const text = this.i18n.translate('profile.errors.fixFields', {
      count: this.invalidLabels().length,
      fields: this.invalidLabels().join(', '),
    });
    this.invalidAnnouncement.set('');
    setTimeout(() => this.invalidAnnouncement.set(text), 100);
  }

  // Красная рамка видна не всем (а экранному диктору не видна совсем), поэтому после неудачной отправки
  // переводим фокус на первое поле с ошибкой: диктор прочитает его подпись и текст ошибки.
  // Нужные элементы помечены в шаблоне атрибутом data-field="путь поля".
  private focusFirstInvalid(): void {
    const first = FIELD_LABELS.find(([path]) => this.form.get(path)?.invalid);
    const element =
      first && this.host.nativeElement.querySelector<HTMLElement>(`[data-field="${first[0]}"]`);
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
    // Ссылка уже стоит в поле, но в базу ещё не записана.
    let linkInForm = false;
    try {
      const result = await this.connect.finish();
      if (!result) {
        return;
      }
      contacts.controls[result.field].setValue(result.link);
      linkInForm = true;
      await withNetworkTimeout(
        this.profiles.saveContacts(this.uid, this.trimmed(contacts.getRawValue())),
        this.window,
      );
      const platform = this.i18n.translate(`profile.contacts.${result.field}`);
      this.snackBar.open(this.i18n.translate('profile.connect.done', { platform }), undefined, {
        duration: 3000,
      });
    } catch (error) {
      if (error instanceof NetworkTimeoutError) {
        // Ссылку получили, и она стоит в очереди на устройстве — это не «не удалось подключить».
        this.waitForSync(error.pending);
        return;
      }
      console.error(error);
      if (linkInForm) {
        // Ссылку получили, а записать не смогли. Помечаем контакты «изменёнными» —
        // тогда загорится «Сохранить», и ссылку можно сохранить вручную, не подключаясь заново.
        contacts.markAsDirty();
      }
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
