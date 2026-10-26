import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-home',
  imports: [RouterLink, MatButtonModule, MatIconModule, TranslatePipe],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  // key указывает на раздел home.features.<key> в файлах переводов (там title и text).
  protected readonly features = [
    { icon: 'sports_esports', key: 'games' },
    { icon: 'devices', key: 'platform' },
    { icon: 'favorite', key: 'match' },
  ];
}
