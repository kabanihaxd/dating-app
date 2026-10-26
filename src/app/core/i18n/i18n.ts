import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

// Список языков. Названия пишем на самом языке — так человек найдёт свой, даже если не понимает текущий.
export const LANGUAGES = [
  { code: 'uk', short: 'UA', label: 'Українська' },
  { code: 'ru', short: 'RU', label: 'Русский' },
  { code: 'en', short: 'EN', label: 'English' },
  { code: 'sk', short: 'SK', label: 'Slovenčina' },
] as const;

// Тип 'uk' | 'ru' | 'en' | 'sk' выводится из массива выше — не нужно дублировать список.
export type Lang = (typeof LANGUAGES)[number]['code'];

// Словарь — вложенный объект: { nav: { feed: 'Анкети' } }. Ключ 'nav.feed' — путь внутри него.
interface Dictionary {
  [key: string]: string | Dictionary;
}

const DEFAULT_LANG: Lang = 'uk';
const STORAGE_KEY = 'di-lang';

@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  // Уже скачанные словари: повторное переключение на язык не делает новый запрос.
  private readonly cache = new Map<Lang, Dictionary>();
  private readonly dictionary = signal<Dictionary>({});
  private readonly currentLang = signal<Lang>(DEFAULT_LANG);

  // Наружу отдаём только чтение: менять язык можно лишь через use().
  readonly lang = this.currentLang.asReadonly();
  readonly language = computed(() => LANGUAGES.find((l) => l.code === this.lang())!);

  // Вызывается один раз при старте приложения (см. app.config.ts).
  init(): Promise<void> {
    return this.use(this.savedLang() ?? DEFAULT_LANG);
  }

  async use(lang: Lang): Promise<void> {
    let dict = this.cache.get(lang);
    if (!dict) {
      // Файлы лежат в public/i18n — Angular отдаёт папку public как есть.
      dict = await firstValueFrom(this.http.get<Dictionary>(`i18n/${lang}.json`));
      this.cache.set(lang, dict);
    }
    this.dictionary.set(dict);
    this.currentLang.set(lang);
    this.document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Приватный режим браузера может запретить localStorage — просто не запоминаем.
    }
  }

  // translate('home.title') → 'Знайди свого'. Параметры подставляются в {{name}}.
  // Если ключа нет — возвращаем сам ключ, чтобы сразу было видно, чего не хватает.
  translate(key: string, params?: Record<string, string | number>): string {
    let node: string | Dictionary | undefined = this.dictionary();
    for (const part of key.split('.')) {
      node = typeof node === 'object' ? node[part] : undefined;
    }
    if (typeof node !== 'string') {
      return key;
    }
    return params ? node.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => String(params[name] ?? '')) : node;
  }

  private savedLang(): Lang | null {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return LANGUAGES.some((l) => l.code === saved) ? (saved as Lang) : null;
    } catch {
      return null;
    }
  }
}
