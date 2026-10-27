import { Component, computed, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { MatchInfo } from '../../../core/matching/match-score';
import { Player } from '../../../core/profile/profile.model';

// Карточка одного игрока. Сама ничего не загружает — всё получает через input() от ленты.
@Component({
  selector: 'app-player-card',
  imports: [MatChipsModule, MatIconModule, TranslatePipe],
  templateUrl: './player-card.html',
  styleUrl: './player-card.scss',
})
export class PlayerCard {
  // input.required — без этих данных карточку использовать нельзя, Angular проверит это при сборке.
  readonly player = input.required<Player>();
  readonly age = input.required<number>();
  readonly match = input.required<MatchInfo>();

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
