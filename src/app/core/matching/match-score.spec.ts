import { UserProfile } from '../profile/profile.model';
import { matchScore } from './match-score';

function profile(overrides: Partial<UserProfile>): UserProfile {
  return {
    name: 'Test',
    birthDate: '2000-01-01',
    city: 'Kyiv',
    bio: '',
    photo: null,
    games: [],
    platforms: [],
    genres: [],
    playTimes: [],
    ...overrides,
  };
}

describe('matchScore', () => {
  const me = profile({
    games: ['Dota 2', 'Elden Ring'],
    platforms: ['pc'],
    genres: ['rpg', 'moba'],
    playTimes: ['evening'],
  });

  it('gives 100% when the other player shares everything', () => {
    expect(matchScore(me, me).percent).toBe(100);
  });

  it('gives 0% when nothing is shared', () => {
    const other = profile({ games: ['Minecraft'], platforms: ['switch'], genres: ['sandbox'] });
    expect(matchScore(me, other).percent).toBe(0);
  });

  it('compares games ignoring letter case', () => {
    const other = profile({ games: ['dota 2'] });
    expect(matchScore(me, other).commonGames).toEqual(['Dota 2']);
  });

  it('weights a common game higher than a common genre', () => {
    const sameGame = matchScore(me, profile({ games: ['Elden Ring'] }));
    const sameGenre = matchScore(me, profile({ genres: ['rpg'] }));
    expect(sameGame.percent).toBeGreaterThan(sameGenre.percent);
  });

  it('returns 0% for an empty own profile instead of dividing by zero', () => {
    expect(matchScore(profile({}), me).percent).toBe(0);
  });
});
