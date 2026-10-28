import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

// Рамка для «состояний» страницы: пусто, ошибка, не найдено.
// Сама знает только про иконку и цвет, а текст и кнопки страница кладёт внутрь —
// они попадают на место <ng-content> (content projection).
//   <app-state-message icon="search_off">
//     <p>Никого нет</p>
//     <a mat-flat-button>...</a>
//   </app-state-message>
@Component({
  selector: 'app-state-message',
  imports: [MatIconModule],
  template: `
    <mat-icon aria-hidden="true">{{ icon() }}</mat-icon>
    <ng-content />
  `,
  styleUrl: './state-message.scss',
  // host — привязки к самому тегу <app-state-message>: класс по цвету (pink/cyan/error).
  host: { '[class]': 'tone()' },
})
export class StateMessage {
  readonly icon = input.required<string>();
  // pink/cyan — пустые состояния в цветах страницы, error — красная рамка.
  readonly tone = input<'pink' | 'cyan' | 'error'>('pink');
}
