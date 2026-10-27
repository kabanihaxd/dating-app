import { Genre, Platform, PlayTime, UserProfile } from '../profile/profile.model';

// «Вес» совпадений: общая игра важнее всего — в неё можно сразу играть вместе.
const WEIGHTS = { games: 5, platforms: 3, genres: 2, playTimes: 1 };

export interface MatchInfo {
  percent: number; // 0–100: какая доля МОИХ предпочтений есть у другого игрока
  commonGames: string[];
  commonPlatforms: Platform[];
  commonGenres: Genre[];
  commonPlayTimes: PlayTime[];
}

export function matchScore(me: UserProfile, other: UserProfile): MatchInfo {
  // Игры вписывают руками, поэтому сравниваем без учёта регистра: «dota 2» = «Dota 2».
  const otherGames = new Set(other.games.map((game) => game.toLowerCase()));
  const commonGames = me.games.filter((game) => otherGames.has(game.toLowerCase()));
  const commonPlatforms = intersect(me.platforms, other.platforms);
  const commonGenres = intersect(me.genres, other.genres);
  const commonPlayTimes = intersect(me.playTimes, other.playTimes);

  const score =
    commonGames.length * WEIGHTS.games +
    commonPlatforms.length * WEIGHTS.platforms +
    commonGenres.length * WEIGHTS.genres +
    commonPlayTimes.length * WEIGHTS.playTimes;
  const maxScore =
    me.games.length * WEIGHTS.games +
    me.platforms.length * WEIGHTS.platforms +
    me.genres.length * WEIGHTS.genres +
    me.playTimes.length * WEIGHTS.playTimes;

  return {
    percent: maxScore ? Math.round((score / maxScore) * 100) : 0,
    commonGames,
    commonPlatforms,
    commonGenres,
    commonPlayTimes,
  };
}

function intersect<T>(a: readonly T[], b: readonly T[]): T[] {
  return a.filter((item) => b.includes(item));
}
