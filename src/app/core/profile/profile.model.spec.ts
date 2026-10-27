import { ageFrom, isProfileLink, isValidContact } from './profile.model';

describe('isValidContact', () => {
  const steam = ['steamcommunity.com'];

  it('accepts nicknames in any alphabet', () => {
    expect(isValidContact('player_one', steam)).toBe(true);
    expect(isValidContact('Козак Мамай', steam)).toBe(true);
    expect(isValidContact('old.name#1234', steam)).toBe(true);
  });

  it('accepts a link to the right site and an empty value', () => {
    expect(isValidContact('https://steamcommunity.com/id/nickname', steam)).toBe(true);
    expect(isValidContact('', steam)).toBe(true);
  });

  it('rejects links to other sites, even disguised as a nickname', () => {
    expect(isValidContact('https://evil.ru', steam)).toBe(false);
    expect(isValidContact('evil.ru/steam', steam)).toBe(false);
    expect(isValidContact('javascript:alert(1)', steam)).toBe(false);
  });

  it('rejects too short and too long values', () => {
    expect(isValidContact('a', steam)).toBe(false);
    expect(isValidContact('a'.repeat(38), steam)).toBe(false);
  });
});

describe('isProfileLink', () => {
  const steam = ['steamcommunity.com'];

  it('accepts an https link to the site', () => {
    expect(isProfileLink('https://steamcommunity.com/id/nickname', steam)).toBe(true);
  });

  it('accepts a subdomain', () => {
    expect(isProfileLink('https://www.steamcommunity.com/id/nickname', steam)).toBe(true);
  });

  it('rejects plain text and other sites', () => {
    expect(isProfileLink('nickname', steam)).toBe(false);
    expect(isProfileLink('https://example.com/steamcommunity.com', steam)).toBe(false);
  });

  it('rejects look-alike domains', () => {
    expect(isProfileLink('https://steamcommunity.com.evil.ru/id/x', steam)).toBe(false);
    expect(isProfileLink('https://evilsteamcommunity.com/id/x', steam)).toBe(false);
  });

  it('rejects non-https links', () => {
    expect(isProfileLink('http://steamcommunity.com/id/x', steam)).toBe(false);
    expect(isProfileLink('javascript:alert(1)', steam)).toBe(false);
  });
});

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
