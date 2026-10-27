import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../core/auth/auth';
import { I18n } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { matchScore } from '../../core/matching/match-score';
import { SwipeService } from '../../core/matching/swipes';
import { NotificationService } from '../../core/notifications/notifications';
import { ProfileService, profileErrorKey } from '../../core/profile/profile';
import {
  CONTACT_FIELDS,
  CONTACT_SITES,
  ContactField,
  UserContacts,
  UserProfile,
  ageFrom,
  isProfileLink,
} from '../../core/profile/profile.model';

// Всё, что нужно шаблону про один мэтч, — посчитано заранее, чтобы в шаблоне не было логики.
interface MatchView {
  id: string; // id мэтча — он же адрес чата /chat/{id}
  uid: string;
  profile: UserProfile;
  age: number;
  commonGames: string[];
  contacts: { field: ContactField; value: string; isLink: boolean }[];
}

@Component({
  selector: 'app-matches',
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule, TranslatePipe],
  templateUrl: './matches.html',
  styleUrl: './matches.scss',
})
export class Matches {
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(ProfileService);
  private readonly swipes = inject(SwipeService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18n);

  protected readonly loading = signal(true);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly matches = signal<MatchView[]>([]);

  // Превью последнего сообщения и «непрочитано» берём из живой подписки уведомлений,
  // поэтому они обновляются на странице сами, без перезагрузки.
  protected readonly notifications = inject(NotificationService);
  protected readonly me = this.auth.user()!.uid;

  constructor() {
    // Открыл страницу — значит, новые мэтчи увидел: значок в меню гаснет.
    this.notifications.markMatchesSeen();
    void this.load();
  }

  protected async copy(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    this.snackBar.open(this.i18n.translate('matches.copied'), undefined, { duration: 2000 });
  }

  private async load(): Promise<void> {
    // Страница закрыта authGuard, поэтому пользователь здесь всегда есть.
    const me = this.auth.user()!.uid;
    try {
      const [{ profile: myProfile }, matches] = await Promise.all([
        this.profiles.load(me),
        this.swipes.listMatches(me),
      ]);
      // Анкеты и контакты всех мэтчей — параллельно. Контакты нам отдают, потому что мэтч есть (см. firestore.rules).
      const loaded = await Promise.all(matches.map((match) => this.profiles.load(match.otherUid)));

      this.matches.set(
        matches.flatMap((match, i) => {
          const { profile, contacts } = loaded[i];
          // Человек удалил анкету — мэтч не показываем.
          if (!profile) {
            return [];
          }
          return [
            {
              id: match.id,
              uid: match.otherUid,
              profile,
              age: ageFrom(profile.birthDate),
              commonGames: myProfile ? matchScore(myProfile, profile).commonGames : [],
              contacts: this.toContactList(contacts),
            },
          ];
        }),
      );
    } catch (error) {
      this.errorKey.set(profileErrorKey(error));
    } finally {
      this.loading.set(false);
    }
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
