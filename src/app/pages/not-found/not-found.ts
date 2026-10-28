import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { StateMessage } from '../../shared/state-message/state-message';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, MatButtonModule, TranslatePipe, StateMessage],
  template: `
    <app-state-message icon="videogame_asset_off">
      <h2>{{ 'notFound.title' | t }}</h2>
      <p>{{ 'notFound.text' | t }}</p>
      <a mat-flat-button routerLink="/">{{ 'notFound.home' | t }}</a>
    </app-state-message>
  `,
})
export class NotFound {}
