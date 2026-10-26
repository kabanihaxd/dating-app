import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { I18n } from './core/i18n/i18n';
import { provideFirebase } from './core/firebase/firebase';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideFirebase(),
    // Приложение ждёт загрузки словаря и только потом рисует страницу — без мелькания ключей вроде 'nav.feed'.
    provideAppInitializer(() => inject(I18n).init()),
  ],
};
