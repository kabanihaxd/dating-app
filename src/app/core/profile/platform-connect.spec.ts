import { steamLoginUrl, steamProfileLink } from './platform-connect';

describe('steamLoginUrl', () => {
  it('sends the user back to our page', () => {
    const url = new URL(
      steamLoginUrl('http://localhost:4200/profile?connect=steam', 'http://localhost:4200'),
    );
    expect(url.origin).toBe('https://steamcommunity.com');
    expect(url.searchParams.get('openid.return_to')).toBe(
      'http://localhost:4200/profile?connect=steam',
    );
  });
});

describe('steamProfileLink', () => {
  const answer = (claimedId: string, mode = 'id_res') =>
    new URLSearchParams({ 'openid.mode': mode, 'openid.claimed_id': claimedId });

  it('turns the Steam answer into a profile link', () => {
    expect(steamProfileLink(answer('https://steamcommunity.com/openid/id/76561198000000001'))).toBe(
      'https://steamcommunity.com/profiles/76561198000000001',
    );
  });

  it('returns null when the user cancelled', () => {
    expect(steamProfileLink(answer('', 'cancel'))).toBeNull();
  });

  it('ignores ids from other sites', () => {
    expect(steamProfileLink(answer('https://evil.example/openid/id/76561198000000001'))).toBeNull();
  });
});
