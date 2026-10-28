import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth';
import { firestoreErrorKey } from '../../core/firebase/firestore-errors';
import { confirmLeave } from '../../core/guards/leave-dialog';
import { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import { I18n } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
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
  // Человек уже пытался сохранить форму с ошибками — с этого момента показываем список полей, которые надо поправить.
  protected readonly showInvalid = signal(false);
  // Уходим на сайт Steam/Discord после подтверждения — второй раз (в beforeunload) не спрашиваем.
  private leavingForConnect = false;

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
    void this.load();
  }

  protected addGame(value: string, input: HTMLInputElement): void {
    const name = value.trim();
    const games = this.form.controls.games.value;
    const isDuplicate = games.some((game) => game.toLowerCase() === name.toLowerCase());
    if (name && !isDuplicate && games.length < this.maxGames) {
      this.form.controls.games.setValue([...games, name]);
      this.form.controls.games.markAsDirty();
    }
    input.value = '';
    this.gameQuery.set('');
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

  // Для guard'а и beforeunload: правки есть, и они не уходят прямо сейчас на сервер.
  hasUnsavedChanges(): boolean {
    return this.form.dirty && !this.saving();
  }

  // preventDefault() просит браузер показать своё окно «Покинуть сайт?». Текст окна задаёт сам браузер.
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges() && !this.leavingForConnect) {
      event.preventDefault();
    }
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorKey.set(null);
      this.showInvalid.set(true);
      this.focusFirstInvalid();
      return;
    }
    this.saving.set(true);
    this.errorKey.set(null);
    this.showInvalid.set(false);
    const { contacts, ...profile } = this.form.getRawValue();
    try {
      await this.profiles.save(
        this.uid,
        { ...profile, photo: this.photo() },
        this.trimmed(contacts),
      );
      this.form.markAsPristine();
      if (this.isNew()) {
        // Анкета готова — сразу показываем то, ради чего её заполняли: ленту игроков.
        this.isNew.set(false);
        this.snackBar.open(this.i18n.translate('profile.saved'), undefined, { duration: 3000 });
        await this.router.navigate(['/feed']);
      } else {
        // После сохранения «Сохранить» гаснет (форма снова pristine), и фокус с неё пропал бы
        // в никуда — переносим его на заголовок страницы, чтобы клавиатура не теряла место.
        this.host.nativeElement.querySelector<HTMLElement>('h1')?.focus();
        // onAction() срабатывает, когда нажали кнопку на самом снекбаре.
        this.snackBar
          .open(this.i18n.translate('profile.saved'), this.i18n.translate('profile.toFeed'), {
            duration: 5000,
          })
          .onAction()
          .subscribe(() => void this.router.navigate(['/feed']));
      }
    } catch (error) {
      this.errorKey.set(firestoreErrorKey(error));
    } finally {
      this.saving.set(false);
    }
  }

  // Уходим на сайт Steam/Discord. Страница перезагрузится, поэтому несохранённые правки пропадут —
  // предупреждаем тем же окном, что и guard при переходе на другую страницу.
  protected async connectPlatform(field: ContactField): Promise<void> {
    if (this.form.dirty && !(await confirmLeave(this.dialog, this.i18n))) {
      return;
    }
    this.leavingForConnect = true;
    this.connect.start(field);
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
    try {
      const result = await this.connect.finish();
      if (!result) {
        return;
      }
      const contacts = this.form.controls.contacts;
      contacts.controls[result.field].setValue(result.link);
      await this.profiles.saveContacts(this.uid, this.trimmed(contacts.getRawValue()));
      const platform = this.i18n.translate(`profile.contacts.${result.field}`);
      this.snackBar.open(this.i18n.translate('profile.connect.done', { platform }), undefined, {
        duration: 3000,
      });
    } catch (error) {
      console.error(error);
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
