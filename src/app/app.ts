import { Component, ElementRef, viewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from './core/i18n/translate.pipe';
import { Footer } from './layout/footer/footer';
import { Header } from './layout/header/header';
import { OfflineBanner } from './layout/offline-banner/offline-banner';

@Component({
  imports: [RouterOutlet, Header, OfflineBanner, Footer, TranslatePipe],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

  // «К содержимому»: переводим фокус на <main>, и следующий Tab попадёт в первую ссылку
  // или поле страницы. Обычный переход по href="#main" здесь не годится: в index.html стоит
  // <base href="/">, и «#main» браузер понял бы как «/#main» — то есть ушёл бы на главную.
  // Поэтому отменяем переход (preventDefault) и делаем то же самое сами.
  protected skipToMain(event: Event): void {
    event.preventDefault();
    this.main().nativeElement.focus();
  }
}
