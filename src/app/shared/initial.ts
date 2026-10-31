// Первая буква имени для монограммы — «аватара» игрока без фото (лента, мэтчи, чат).
// Intl.Segmenter режет по «видимым символам» (графемам), а не по кодовым единицам: у имени,
// начинающегося с эмодзи или с буквы из двух символов Юникода, name[0] дал бы половинку знака.
// Пустое имя — нейтральный «?».
export function initialOf(name: string, lang: string): string {
  const first = new Intl.Segmenter(lang, { granularity: 'grapheme' })
    .segment(name.trim())
    [Symbol.iterator]()
    .next().value?.segment;
  return first ? first.toLocaleUpperCase(lang) : '?';
}
