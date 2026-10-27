import { Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { MatchInfo } from '../../../core/matching/match-score';
import { Player } from '../../../core/profile/profile.model';
import { ModerationMenu } from '../../../shared/moderation-menu/moderation-menu';

// Карточка одного игрока. Сама ничего не загружает и не сохраняет:
// данные получает через input(), а о нажатых кнопках сообщает ленте через output().
@Component({
  selector: 'app-player-card',
  imports: [MatButtonModule, MatChipsModule, MatIconModule, TranslatePipe, ModerationMenu],
  templateUrl: './player-card.html',
  styleUrl: './player-card.scss',
})
export class PlayerCard {
  // input.required — без этих данных карточку использовать нельзя, Angular проверит это при сборке.
  readonly player = input.required<Player>();
  readonly age = input.required<number>();
  readonly match = input.required<MatchInfo>();
  // true, пока лента сохраняет лайк/пропуск — кнопки выключены, чтобы не нажать дважды.
  readonly busy = input(false);
  // Этот игрок уже лайкнул меня — показываем метку.
  readonly likedMe = input(false);

  // output — «событие» компонента. Лента подписывается на него так: (liked)="like(...)".
  readonly liked = output<void>();
  readonly skipped = output<void>();

  // Остальные игры игрока — те, что не совпали с моими.
  protected readonly otherGames = computed(() => {
    const common = new Set(this.match().commonGames.map((game) => game.toLowerCase()));
    return this.player().games.filter((game) => !common.has(game.toLowerCase()));
  });

  // Цвет полоски совместимости: от 70% — розовая, от 40% — бирюзовая, ниже — серая.
  protected readonly level = computed(() => {
    const percent = this.match().percent;
    return percent >= 70 ? 'high' : percent >= 40 ? 'medium' : 'low';
  });
}
