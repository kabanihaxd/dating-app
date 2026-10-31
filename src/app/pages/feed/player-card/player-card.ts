import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18n } from '../../../core/i18n/i18n';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { MatchInfo } from '../../../core/matching/match-score';
import { Player } from '../../../core/profile/profile.model';
import { ModerationMenu } from '../../../shared/moderation-menu/moderation-menu';

// Сколько «других игр» видно сразу. Остальные — под кнопкой «Больше об игроке».
const VISIBLE_OTHER_GAMES = 3;
// Длинное описание обрезается до трёх строк — тогда тоже нужна кнопка «Больше».
const LONG_BIO = 120;

// Карточка одного игрока. Сама ничего не загружает и не сохраняет:
// данные получает через input(), а о нажатых кнопках сообщает ленте через output().
@Component({
  selector: 'app-player-card',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslatePipe, ModerationMenu],
  templateUrl: './player-card.html',
  styleUrl: './player-card.scss',
})
export class PlayerCard {
  private readonly i18n = inject(I18n);

  // input.required — без этих данных карточку использовать нельзя, Angular проверит это при сборке.
  readonly player = input.required<Player>();
  readonly age = input.required<number>();
  readonly match = input.required<MatchInfo>();
  // Этот игрок уже лайкнул меня — показываем метку.
  readonly likedMe = input(false);
  // false — кнопки «Лайк/Пропустить» рисует лента (режим «по одному»).
  readonly showActions = input(true);

  // output — «событие» компонента. Лента подписывается на него так: (liked)="like(...)".
  readonly liked = output<void>();
  readonly skipped = output<void>();
  // Игрока заблокировали через «⋮» — лента переведёт фокус на соседнюю карточку.
  readonly removed = output<void>();

  protected readonly expanded = signal(false);

  // id заголовка: по нему лента переводит фокус на следующую карточку после лайка.
  // uid из Firebase — только буквы и цифры, поэтому годится для id как есть.
  readonly headingId = computed(() => `player-${this.player().uid}-name`);
  protected readonly detailsId = computed(() => `player-${this.player().uid}-details`);

  // Первая буква имени для монограммы вместо фото. Intl.Segmenter режет по «видимым символам»
  // (графемам), а не по кодовым единицам: у имени с эмодзи или «й» из двух символов Юникода
  // name[0] дал бы половинку знака. Пустое имя — нейтральный «?».
  protected readonly initial = computed(() => {
    const name = this.player().name.trim();
    const first = new Intl.Segmenter(this.i18n.lang(), { granularity: 'grapheme' })
      .segment(name)
      [Symbol.iterator]()
      .next().value?.segment;
    return first ? first.toLocaleUpperCase(this.i18n.lang()) : '?';
  });

  protected readonly hasOverlap = computed(() => {
    const m = this.match();
    return m.commonGames.length + m.commonPlayTimes.length + m.commonGenres.length > 0;
  });

  // Остальные игры игрока — те, что не совпали с моими.
  protected readonly otherGames = computed(() => {
    const common = new Set(this.match().commonGames.map((game) => game.toLowerCase()));
    return this.player().games.filter((game) => !common.has(game.toLowerCase()));
  });
  // Скрыть ровно одну игру за «+1» и кнопкой «Подробнее» — дороже, чем просто её показать:
  // пилюля «+1» и кнопка занимают больше места, чем сама игра. Поэтому сворачиваем,
  // только если прячется хотя бы две (иначе показываем все четыре сразу).
  private readonly gamesFold = computed(() => this.otherGames().length > VISIBLE_OTHER_GAMES + 1);
  protected readonly visibleOtherGames = computed(() =>
    this.expanded() || !this.gamesFold()
      ? this.otherGames()
      : this.otherGames().slice(0, VISIBLE_OTHER_GAMES),
  );
  protected readonly hiddenGames = computed(
    () => this.otherGames().length - this.visibleOtherGames().length,
  );

  protected readonly canExpand = computed(
    () => this.gamesFold() || this.player().bio.length > LONG_BIO,
  );

  // Цвет полоски совместимости: от 70% — розовая, от 40% — бирюзовая, ниже — серая.
  protected readonly level = computed(() => {
    const percent = this.match().percent;
    return percent >= 70 ? 'high' : percent >= 40 ? 'medium' : 'low';
  });

  // ['evening', 'weekends'] → «Ввечері · На вихідних». group — раздел справочника в переводах.
  protected joined(group: string, keys: readonly string[]): string {
    return keys.map((key) => this.i18n.translate(`${group}.${key}`)).join(' · ');
  }
}
