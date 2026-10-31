import { Component, DOCUMENT, computed, inject, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18n } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  CONTACT_FIELDS,
  CONTACT_SITES,
  ContactField,
  UserContacts,
  isProfileLink,
} from '../../core/profile/profile.model';

// Один контакт в том виде, в каком его рисует чип.
// short — короткое имя платформы («PSN» вместо «PlayStation Network»).
// shown — что написать после платформы: ник как есть, у ссылки — читаемый хвост адреса
// (steamcommunity.com/id/anya → «anya»). null — хвост бессмысленный (числовой id),
// тогда шаблон пишет переведённое слово «профиль».
interface ContactView {
  field: ContactField;
  short: string;
  value: string;
  shown: string | null;
  isLink: boolean;
}

// Короткие названия платформ для чипов. Это имена брендов, их не переводят.
const CONTACT_SHORT: Record<ContactField, string> = {
  discord: 'Discord',
  steam: 'Steam',
  psn: 'PSN',
  xbox: 'Xbox',
};

// Ряд чипов с контактами игрока: «PSN · di_tester_1». Ник копируется по нажатию (чип на 1,5 с
// пишет «Скопировано»), проверенная ссылка открывается в новой вкладке. Один компонент на
// карточку мэтча и на карточку собеседника в чате — чтобы контакты везде вели себя одинаково.
//   <app-contact-chips [contacts]="contacts" [name]="name" idPrefix="match-42" />
@Component({
  selector: 'app-contact-chips',
  imports: [MatIconModule, MatTooltipModule, TranslatePipe],
  templateUrl: './contact-chips.html',
  styleUrl: './contact-chips.scss',
})
export class ContactChips {
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18n);
  private readonly document = inject(DOCUMENT);

  // Контакты как они лежат в базе (null — документа нет или не загрузился).
  readonly contacts = input<UserContacts | null>(null);
  // Имя владельца контактов — для подписей программе чтения с экрана.
  readonly name = input.required<string>();
  // Уникальный кусок id для поля запасного копирования: на странице может быть много карточек.
  readonly idPrefix = input.required<string>();

  // Только заполненные контакты. Ссылкой считаем лишь проверенную ссылку на сайт платформы —
  // всё остальное показываем как обычный текст (ник), даже если там что-то похожее на адрес.
  protected readonly list = computed<ContactView[]>(() => {
    const contacts = this.contacts();
    return CONTACT_FIELDS.flatMap((field) => {
      const value = contacts?.[field]?.trim() ?? '';
      return value
        ? [
            {
              field,
              short: CONTACT_SHORT[field],
              value,
              ...shownValue(value, CONTACT_SITES[field].domains),
            },
          ]
        : [];
    });
  });

  // Какой чип сейчас показывает «Скопировано». Обратная связь прямо на чипе, под пальцем,
  // а не только снекбаром внизу экрана. Через 1,5 с чип возвращается.
  protected readonly copiedField = signal<ContactField | null>(null);
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;
  // Чип, у которого копирование не удалось: под контактами показываем поле с выделенным ником,
  // чтобы его можно было скопировать руками (Ctrl+C или долгим нажатием на телефоне).
  protected readonly copyFailedField = signal<ContactField | null>(null);

  protected manualId(field: ContactField): string {
    return `manual-${this.idPrefix()}-${field}`;
  }

  // Буфер обмена может быть недоступен (нет разрешения, старый браузер, не https) —
  // тогда честно говорим об этом и даём запасной путь: поле с уже выделенным ником.
  protected async copy(contact: ContactView, platform: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(contact.value);
      this.copyFailedField.set(null);
      // Снекбар остаётся рядом с чипом «Скопировано»: он ещё и вежливо озвучивает результат
      // программе чтения с экрана (MatSnackBar — это live-регион).
      this.copiedField.set(contact.field);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copiedField.set(null), 1500);
      this.snackBar.open(
        this.i18n.translate('matches.copiedValue', { platform, value: contact.value }),
        undefined,
        { duration: 2000 },
      );
    } catch (error) {
      console.error(error);
      this.copiedField.set(null);
      this.copyFailedField.set(contact.field);
      this.snackBar.open(this.i18n.translate('matches.copyFailed'), undefined, { duration: 6000 });
      // Поле запасного копирования появится после перерисовки — тогда ставим в него фокус
      // и выделяем ник целиком: остаётся нажать Ctrl+C (на телефоне — «Копировать»).
      setTimeout(() => {
        const field = this.document.getElementById(
          this.manualId(contact.field),
        ) as HTMLInputElement | null;
        field?.focus();
        field?.select();
      });
    }
  }
}

// Что показать на чипе. Ник — как есть. У ссылки — последний кусок пути без хоста:
// steamcommunity.com/id/anya → «anya». Если этот кусок — одни цифры (discord.com/users/1234…,
// steamcommunity.com/profiles/7656…), человеку он ничего не скажет: возвращаем null,
// и шаблон напишет слово «профиль» на языке интерфейса.
function shownValue(
  value: string,
  domains: readonly string[],
): { isLink: boolean; shown: string | null } {
  if (!isProfileLink(value, domains)) {
    return { isLink: false, shown: value };
  }
  const tail = new URL(value).pathname.split('/').filter(Boolean).pop() ?? '';
  let shown = tail;
  try {
    shown = decodeURIComponent(tail); // %D0%B0%D0%BD%D1%8F → «аня»
  } catch {
    // битая %-последовательность — оставляем как есть
  }
  return { isLink: true, shown: shown && !/^\d+$/.test(shown) ? shown : null };
}
