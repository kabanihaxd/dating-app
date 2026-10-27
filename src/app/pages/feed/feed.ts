import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../core/auth/auth';
import { I18n } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { matchScore } from '../../core/matching/match-score';
import { SwipeService, matchId } from '../../core/matching/swipes';
import { NotificationService } from '../../core/notifications/notifications';
import { ProfileService, profileErrorKey } from '../../core/profile/profile';
import {
  PLATFORMS,
  Platform,
  Player,
  UserProfile,
  ageFrom,
} from '../../core/profile/profile.model';
import { PlayerCard } from './player-card/player-card';

const MIN_AGE = 18;
const MAX_AGE = 99;

@Component({
  selector: 'app-feed',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    TranslatePipe,
    PlayerCard,
  ],
  templateUrl: './feed.html',
  styleUrl: './feed.scss',
})
export class Feed {
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(ProfileService);
  private readonly swipes = inject(SwipeService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18n);
  private readonly router = inject(Router);
  protected readonly notifications = inject(NotificationService);

  protected readonly platforms = PLATFORMS;
  protected readonly minAge = MIN_AGE;
  protected readonly maxAge = MAX_AGE;

  protected readonly loading = signal(true);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly me = signal<UserProfile | null>(null);
  protected readonly players = signal<Player[]>([]);
  // uid тех, кого я уже лайкнул или пропустил.
  private readonly swiped = signal(new Set<string>());
  // uid карточки, для которой сейчас сохраняется лайк/пропуск.
  protected readonly pendingUid = signal<string | null>(null);

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

  // Варианты для фильтра «Игра»: мои игры и игры всех игроков, без повторов, по алфавиту.
  protected readonly gameOptions = computed(() => {
    const games = [
      ...(this.me()?.games ?? []),
      ...this.players().flatMap((player) => player.games),
    ];
    return [...new Set(games)].sort((a, b) => a.localeCompare(b));
  });

  // Главная часть ленты: считаем совместимость, фильтруем.
  // Порядок: сначала те, кто уже лайкнул меня (лайк в ответ = мэтч), дальше — по совместимости.
  protected readonly results = computed(() => {
    const me = this.me();
    if (!me) {
      return [];
    }
    const { game, platform, city, minAge, maxAge } = this.filterValues();
    // Пустое числовое поле даёт null — тогда считаем, что ограничения нет.
    const from = minAge || MIN_AGE;
    const to = maxAge || MAX_AGE;
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

  constructor() {
    void this.load();
  }

  protected resetFilters(): void {
    this.filters.reset();
  }

  protected like(player: Player): Promise<void> {
    return this.swipe(player, async () => {
      const matched = await this.swipes.like(this.uid, player.uid);
      if (matched) {
        this.showMatch(player);
      }
    });
  }

  protected skip(player: Player): Promise<void> {
    return this.swipe(player, () => this.swipes.skip(this.uid, player.uid));
  }

  // Общая часть лайка и пропуска: блокируем кнопки, сохраняем, убираем карточку из ленты.
  private async swipe(player: Player, action: () => Promise<void>): Promise<void> {
    this.pendingUid.set(player.uid);
    try {
      await action();
      // Set внутри signal меняем через update и НОВЫЙ Set — иначе signal не заметит изменения.
      this.swiped.update((uids) => new Set(uids).add(player.uid));
    } catch (error) {
      this.snackBar.open(this.i18n.translate(profileErrorKey(error)), undefined, {
        duration: 4000,
      });
    } finally {
      this.pendingUid.set(null);
    }
  }

  // «Это мэтч!» с кнопкой «Написать» — сразу в чат с этим игроком.
  private showMatch(player: Player): void {
    this.snackBar
      .open(
        this.i18n.translate('feed.matchToast', { name: player.name }),
        this.i18n.translate('feed.matchAction'),
        {
          duration: 6000,
        },
      )
      .onAction()
      .subscribe(() => this.router.navigate(['/chat', matchId(this.uid, player.uid)]));
  }

  // Страница закрыта authGuard, поэтому пользователь здесь всегда есть.
  private get uid(): string {
    return this.auth.user()!.uid;
  }

  private async load(): Promise<void> {
    const uid = this.uid;
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
    } catch (error) {
      this.errorKey.set(profileErrorKey(error));
    } finally {
      this.loading.set(false);
    }
  }
}
