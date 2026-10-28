import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './layout/header/header';
import { OfflineBanner } from './layout/offline-banner/offline-banner';

@Component({
  imports: [RouterOutlet, Header, OfflineBanner],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {}
