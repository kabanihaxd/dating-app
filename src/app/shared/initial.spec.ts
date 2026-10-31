import { initialOf } from './initial';

describe('initialOf', () => {
  it('берёт первую букву и делает её заглавной', () => {
    expect(initialOf('аня', 'ru')).toBe('А');
    expect(initialOf('  max', 'en')).toBe('M');
  });

  it('не режет эмодзи и составные символы пополам', () => {
    expect(initialOf('👩‍🚀 Lena', 'en')).toBe('👩‍🚀');
    expect(initialOf('й'.normalize('NFD'), 'ru')).toBe('Й'.normalize('NFD'));
  });

  it('пустое имя — «?»', () => {
    expect(initialOf('   ', 'en')).toBe('?');
  });
});
