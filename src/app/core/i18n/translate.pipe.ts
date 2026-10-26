import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18n } from './i18n';

// В шаблоне: {{ 'nav.feed' | t }}
// pure: false — обычный (pure) pipe запоминает результат для одинакового ключа и не заметил бы смену языка.
// Поиск в словаре очень дешёвый, поэтому пересчитывать при каждой проверке шаблона не страшно.
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(key: string, params?: Record<string, string | number>): string {
    return this.i18n.translate(key, params);
  }
}
