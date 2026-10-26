import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, TranslatePipe],
  template: `
    <h2>{{ 'notFound.title' | t }}</h2>
    <p>{{ 'notFound.text' | t }} <a routerLink="/">{{ 'notFound.home' | t }}</a></p>
  `,
})
export class NotFound {}
