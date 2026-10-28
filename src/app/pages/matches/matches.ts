import { Component, ElementRef, computed, effect, inject, signal, untracked } from '@angular/core';
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

  // Сам список мэтчей, превью последнего сообщения и «непрочитано» берём из живой подписки
  // уведомлений (onSnapshot), поэтому всё это обновляется на странице само, без перезагрузки.
  protected readonly notifications = inject(NotificationService);
  protected readonly me = this.auth.user()!.uid;

  // Моя анкета нужна, чтобы посчитать общие игры. undefined — ещё грузится, null — анкеты нет.
  private readonly myProfile = signal<UserProfile | null | undefined>(undefined);
  // Кэш карточек по uid: анкету и контакты каждого игрока читаем один раз, а не на каждый
  // новый снимок мэтчей (новое сообщение тоже меняет снимок). null — анкеты нет или контакты закрыты.
  private readonly views = signal(new Map<string, MatchView | null>());
  // uid, за которыми уже отправлен запрос, — чтобы не запрашивать одного и того же дважды.
  private readonly requested = new Set<string>();
  // Карточки, убранные через «⋮», прячем сразу, не дожидаясь, пока снимок из базы догонит.
  private readonly removedUids = signal(new Set<string>());
  // Первая партия карточек догружена. Дальше новые мэтчи просто «доезжают» в сетку,
  // а не возвращают всю страницу в скелетон.
  private readonly firstBatchLoaded = signal(false);
  private readonly profileErrorKey = signal<string | null>(null);
  // Счётчик повторов: увеличили — эффект ниже снова запускает sync() и дозапрашивает упавших.
  private readonly attempt = signal(0);

  // Три серые заготовки карточек на время загрузки.
  protected readonly skeletons = [0, 1, 2];

  // Ошибка — либо при чтении моей анкеты, либо у живой подписки на мэтчи.
  protected readonly errorKey = computed(() => {
    const subscriptionError = this.notifications.matchesError();
    return (
      this.profileErrorKey() ?? (subscriptionError ? firestoreErrorKey(subscriptionError) : null)
    );
  });

  protected readonly loading = computed(
    () =>
      !this.notifications.matchesReady() ||
      this.myProfile() === undefined ||
      !this.firstBatchLoaded(),
  );

  // Состав и порядок — из живого списка мэтчей, данные карточки — из кэша.
  // Если мэтч разорвали или меня заблокировали, пока страница открыта, — карточка исчезает сама.
  protected readonly visibleMatches = computed(() => {
    const hidden = this.notifications.hidden();
    const removed = this.removedUids();
    const views = this.views();
    return this.notifications.matchList().flatMap((match) => {
      const view = views.get(match.otherUid);
      return view && !hidden.has(match.otherUid) && !removed.has(match.otherUid) ? [view] : [];
    });
  });

  constructor() {
    // Открыл страницу — значит, новые мэтчи увидел: значок в меню гаснет.
    this.notifications.markMatchesSeen();
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
  }

  // Кнопка «Попробовать ещё раз» на ошибке загрузки.
  protected retry(): void {
    this.profileErrorKey.set(null);
    if (this.notifications.matchesError()) {
      this.notifications.retryMatches();
    }
    if (this.myProfile() === undefined) {
      void this.loadMyProfile();
    }
    // Тех, кого не удалось загрузить, запросим снова.
    const failed = [...this.views()].filter(([, view]) => !view).map(([uid]) => uid);
    failed.forEach((uid) => this.requested.delete(uid));
    this.views.update((views) => new Map([...views].filter(([, view]) => view)));
    this.attempt.update((n) => n + 1);
  }

  // Мэтч разорван или человек заблокирован — убираем карточку и переносим фокус. Иначе он
  // «провалится» в начало страницы вместе с исчезнувшей кнопкой «⋮». Куда: на имя следующей
  // карточки, если её нет — предыдущей, а если карточек не осталось — на заголовок страницы.
  protected remove(uid: string): void {
    const list = this.visibleMatches();
    const index = list.findIndex((match) => match.uid === uid);
    const target = list[index + 1] ?? list[index - 1];
    this.removedUids.update((removed) => new Set(removed).add(uid));
    // Заголовок соседней карточки и h1 уже есть в DOM, поэтому фокус можно ставить сразу.
    const id = target ? target.headingId : 'matches-title';
    this.host.nativeElement.querySelector<HTMLElement>(`#${id}`)?.focus();
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
      this.views.update((views) => new Map([...views].filter(([uid]) => current.has(uid))));
      this.removedUids.update((removed) => new Set([...removed].filter((uid) => current.has(uid))));
    }

    const fresh = list.filter((match) => !this.requested.has(match.otherUid));
    fresh.forEach((match) => this.requested.add(match.otherUid));
    // Анкеты и контакты новых мэтчей — параллельно. Контакты нам отдают, потому что мэтч есть
    // (см. firestore.rules). Мэтч могли разорвать прямо сейчас — тогда контакты уже закрыты;
    // такой мэтч просто пропускаем, а не ломаем из-за него всю страницу.
    await Promise.all(
      fresh.map(async (match) => {
        const { profile, contacts } = await this.profiles
          .load(match.otherUid)
          .catch(() => ({ profile: null, contacts: null }));
        // Пока грузили, мэтч могли разорвать — тогда результат уже не нужен.
        if (this.requested.has(match.otherUid)) {
          this.views.update((views) =>
            new Map(views).set(match.otherUid, this.toView(match, profile, contacts)),
          );
        }
      }),
    );
    this.firstBatchLoaded.set(true);
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
