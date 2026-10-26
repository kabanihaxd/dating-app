import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-home',
  imports: [RouterLink, MatButtonModule, MatIconModule],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  protected readonly features = [
    { icon: 'sports_esports', title: 'Спільні ігри', text: 'Знаходь людей, які грають у те саме, що й ти.' },
    { icon: 'devices', title: 'Твоя платформа', text: 'PC, PlayStation, Xbox, Switch чи мобільні — обирай своїх.' },
    { icon: 'favorite', title: 'Взаємний метч', text: 'Ніки Discord і Steam відкриваються лише після взаємного лайку.' },
  ];
}
