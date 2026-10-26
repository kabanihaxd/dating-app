import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive, MatToolbarModule, MatButtonModule, MatIconModule],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  // Пункты меню храним массивом — шаблон выводит их через @for.
  protected readonly navItems = [
    { path: '/feed', icon: 'sports_esports', label: 'Анкети' },
    { path: '/matches', icon: 'favorite', label: 'Метчі' },
    { path: '/profile', icon: 'person', label: 'Профіль' },
  ];
}
