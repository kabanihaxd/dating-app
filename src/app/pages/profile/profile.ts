import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../core/auth/auth';
import { I18n } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ProfileService, profileErrorKey } from '../../core/profile/profile';
import {
  CONTACT_FIELDS,
  GENRES,
  Genre,
  PLATFORMS,
  PLAY_TIMES,
  Platform,
  PlayTime,
  POPULAR_GAMES,
  ageFrom,
} from '../../core/profile/profile.model';
import { resizeImage } from '../../core/profile/resize-image';

const MIN_AGE = 18;
const MAX_PHOTO_FILE_SIZE = 15 * 1024 * 1024; // 15 МБ — больше не тянем в браузер даже для сжатия

// Валидатор даты рождения: младше 18 — ошибка underage. Пустое поле проверяет Validators.required.
function adultValidator(control: AbstractControl<string>): ValidationErrors | null {
  return control.value && ageFrom(control.value) < MIN_AGE ? { underage: true } : null;
}

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
    MatProgressSpinnerModule,
    TranslatePipe,
  ],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(ProfileService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18n);

  protected readonly maxGames = 20;
  protected readonly maxBioLength = 500;
  protected readonly maxBirthDate = yearsAgo(MIN_AGE);
  protected readonly contactFields = CONTACT_FIELDS;

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
  protected readonly photo = signal<string | null>(null);
  protected readonly photoErrorKey = signal<string | null>(null);
  protected readonly gameQuery = signal('');

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
      discord: ['', Validators.maxLength(50)],
      steam: ['', Validators.maxLength(50)],
      psn: ['', Validators.maxLength(50)],
      xbox: ['', Validators.maxLength(50)],
    }),
  });

  // toSignal превращает поток изменений формы в signal — от него считаются подсказки ниже.
  protected readonly games = toSignal(this.form.controls.games.valueChanges, {
    initialValue: this.form.controls.games.value,
  });

  // Подсказки: популярные игры, которые подходят под набранный текст и ещё не выбраны.
  protected readonly suggestions = computed(() => {
    const query = this.gameQuery().trim().toLowerCase();
    const chosen = new Set(this.games().map((game) => game.toLowerCase()));
    return POPULAR_GAMES.filter((game) => !chosen.has(game.toLowerCase()) && game.toLowerCase().includes(query));
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
    this.form.controls.games.setValue(this.form.controls.games.value.filter((game) => game !== name));
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

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorKey.set('profile.errors.invalidForm');
      return;
    }
    this.saving.set(true);
    this.errorKey.set(null);
    const { contacts, ...profile } = this.form.getRawValue();
    try {
      await this.profiles.save(this.uid, { ...profile, photo: this.photo() }, contacts);
      this.form.markAsPristine();
      this.snackBar.open(this.i18n.translate('profile.saved'), undefined, { duration: 3000 });
    } catch (error) {
      this.errorKey.set(profileErrorKey(error));
    } finally {
      this.saving.set(false);
    }
  }

  // Страница закрыта authGuard, поэтому пользователь здесь всегда есть.
  private get uid(): string {
    return this.auth.user()!.uid;
  }

  private async load(): Promise<void> {
    try {
      const { profile, contacts } = await this.profiles.load(this.uid);
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
      this.errorKey.set(profileErrorKey(error));
    } finally {
      this.loading.set(false);
    }
  }
}
