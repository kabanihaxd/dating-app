import { ageFrom } from './profile.model';

describe('ageFrom', () => {
  const today = new Date(2026, 9, 26); // 26 октября 2026 (месяцы в Date считаются с 0)

  it('counts full years when the birthday has passed', () => {
    expect(ageFrom('2000-01-15', today)).toBe(26);
  });

  it('subtracts a year when the birthday is still ahead', () => {
    expect(ageFrom('2008-10-27', today)).toBe(17);
  });

  it('turns 18 exactly on the birthday', () => {
    expect(ageFrom('2008-10-26', today)).toBe(18);
  });
});
