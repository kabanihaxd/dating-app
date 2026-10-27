import { matchId } from './swipes';

describe('matchId', () => {
  it('is the same no matter who liked first', () => {
    expect(matchId('bob', 'alice')).toBe('alice_bob');
    expect(matchId('alice', 'bob')).toBe('alice_bob');
  });
});
