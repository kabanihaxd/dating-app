import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `<h2>404 — Game Over</h2><p>Такої сторінки немає. <a routerLink="/">На головну</a></p>`,
})
export class NotFound {}
