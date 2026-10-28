import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { I18n } from '../../../core/i18n/i18n';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { MatchInfo } from '../../../core/matching/match-score';
import { ProfileService } from '../../../core/profile/profile';
import {
  CONTACT_FIELDS,
  ContactField,
  Player,
  UserProfile,
} from '../../../core/profile/profile.model';

export interface MatchDialogData {
  me: UserProfile;
  player: Player;
  match: MatchInfo;
}

// 'chat' — пользователь нажал «Написать»; 'contacts' — «Открыть контакты»;
// undefined — закрыл / «Смотреть дальше».
export type MatchDialogResult = 'chat' | 'contacts' | undefined;

// Сколько общих игр показываем тегами; остальные сворачиваем в «+N».
const MAX_GAMES = 4;

// Метка-заглушка вместо имени: по ней режем переведённую фразу на «до» и «после»,
// чтобы выделить имя отдельным <strong>, не собирая HTML из строки.
const NAME_MARK = '\u0000';

// Окно «Это мэтч!». Само ничего не делает: кнопки закрывают его с ответом
// ([mat-dialog-close]="'chat'"), а что делать дальше, решает лента через afterClosed().
@Component({
  selector: 'app-match-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, TranslatePipe],
  templateUrl: './match-dialog.html',
  styleUrl: './match-dialog.scss',
})
export class MatchDialog {
  // inject(MAT_DIALOG_DATA) — данные, переданные в dialog.open(..., { data }).
  protected readonly data = inject<MatchDialogData>(MAT_DIALOG_DATA);
  private readonly i18n = inject(I18n);
  private readonly profiles = inject(ProfileService);

  // Какие контакты игрока открылись: ['discord', 'steam']. null — ещё грузим или не смогли
  // загрузить; тогда показываем общую фразу «Теперь вы видите контакты друг друга».
  // Грузим здесь, а не в ленте: читать контакты разрешено только ПОСЛЕ создания мэтча,
  // а окно как раз открывается, когда мэтч уже записан.
  protected readonly openedContacts = signal<ContactField[] | null>(null);

  // Строка в блоке «Контакты открыты»: список платформ, «контактов нет» или общая фраза.
  protected readonly contactsText = computed(() => {
    const fields = this.openedContacts();
    if (fields === null) {
      return this.i18n.translate('feed.matchDialog.contacts');
    }
    if (!fields.length) {
      return this.i18n.translate('feed.matchDialog.noContacts', { name: this.data.player.name });
    }
    const list = fields
      .map((field) => this.i18n.translate(`profile.contacts.${field}`))
      .join(' · ');
    return this.i18n.translate('feed.matchDialog.contactsList', { list });
  });

  // Кнопка «Открыть контакты» не нужна, если открывать нечего: на странице мэтчей было бы пусто.
  protected readonly canSeeContacts = computed(() => this.openedContacts()?.length !== 0);

  constructor() {
    this.profiles
      .loadContacts(this.data.player.uid)
      .then((contacts) =>
        // Пустые поля — контакт не заполнен, его не считаем.
        this.openedContacts.set(CONTACT_FIELDS.filter((field) => contacts?.[field]?.trim())),
      )
      // Сеть или правила базы подвели — не страшно: остаётся общая фраза, кнопка ведёт к мэтчам.
      .catch(() => this.openedContacts.set(null));
  }

  // computed() пересчитывается сам, когда меняются сигналы внутри (здесь — словарь при смене языка).
  // data не сигнал и не меняется, поэтому списки игр посчитаются один раз.
  protected readonly games = computed(() => this.data.match.commonGames.slice(0, MAX_GAMES));
  protected readonly moreGames = computed(() =>
    Math.max(0, this.data.match.commonGames.length - MAX_GAMES),
  );

  // «ПК · PlayStation · Вечером» — платформы и время игры одной строкой.
  protected readonly meta = computed(() =>
    [
      ...this.data.match.commonPlatforms.map((key) => `catalog.platforms.${key}`),
      ...this.data.match.commonPlayTimes.map((key) => `catalog.playTimes.${key}`),
    ]
      .map((key) => this.i18n.translate(key))
      .join(' · '),
  );

  // Блок «Вы оба играете» нужен, только если есть что в нём показать.
  protected readonly hasCommon = computed(() => this.games().length > 0 || this.meta() !== '');

  // Подзаголовок «{{name}} — твой игрок 2» на части: [до имени, после имени].
  // В разных языках имя стоит в разных местах, поэтому место берём из самого перевода.
  protected readonly subtitle = computed(() => {
    const text = this.i18n.translate('feed.matchDialog.subtitle', { name: NAME_MARK });
    const [before, after = ''] = text.split(NAME_MARK);
    return { before, after };
  });
}
