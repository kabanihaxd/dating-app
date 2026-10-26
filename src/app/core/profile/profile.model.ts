// Справочники игрового профиля. В базе храним ключи ('pc', 'rpg'), а текст берём из переводов: catalog.<группа>.<ключ>.
export const PLATFORMS = ['pc', 'playstation', 'xbox', 'switch', 'mobile'] as const;
export const GENRES = [
  'shooter',
  'rpg',
  'mmo',
  'moba',
  'strategy',
  'horror',
  'survival',
  'sandbox',
  'sports',
  'racing',
  'fighting',
  'indie',
] as const;
export const PLAY_TIMES = ['morning', 'day', 'evening', 'night', 'weekdays', 'weekends'] as const;
export const CONTACT_FIELDS = ['discord', 'steam', 'psn', 'xbox'] as const;

export type Platform = (typeof PLATFORMS)[number];
export type Genre = (typeof GENRES)[number];
export type PlayTime = (typeof PLAY_TIMES)[number];

// Подсказки для поля «Игры». Названия игр не переводим, и можно вписать любую свою.
export const POPULAR_GAMES = [
  'Apex Legends',
  "Baldur's Gate 3",
  'Call of Duty: Warzone',
  'Counter-Strike 2',
  'Cyberpunk 2077',
  'Dead by Daylight',
  'Dead Island 2',
  'Destiny 2',
  'Dota 2',
  'EA Sports FC',
  'Elden Ring',
  'Fortnite',
  'Genshin Impact',
  'GTA V',
  'Helldivers 2',
  'League of Legends',
  'Minecraft',
  'Overwatch 2',
  'PUBG: Battlegrounds',
  'Rocket League',
  'Rust',
  'Stardew Valley',
  'The Witcher 3',
  'Valheim',
  'Valorant',
  'World of Warcraft',
];

// Публичная анкета: users/{uid}. Её увидят другие игроки в ленте.
export interface UserProfile {
  name: string;
  birthDate: string; // 'YYYY-MM-DD' — так отдаёт <input type="date">
  city: string;
  bio: string;
  photo: string | null; // сжатая картинка в виде data URL
  games: string[];
  platforms: Platform[];
  genres: Genre[];
  playTimes: PlayTime[];
}

// Ники — users/{uid}/private/contacts. Отдельный документ, чтобы правила базы могли
// показывать его только после взаимного мэтча (этап 6).
export type UserContacts = Record<(typeof CONTACT_FIELDS)[number], string>;

// Полных лет на дату today. День рождения в этом году ещё не наступил — минус год.
export function ageFrom(birthDate: string, today = new Date()): number {
  const [year, month, day] = birthDate.split('-').map(Number);
  const hadBirthday =
    today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);
  return today.getFullYear() - year - (hadBirthday ? 0 : 1);
}
