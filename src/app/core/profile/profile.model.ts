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

export type ContactField = (typeof CONTACT_FIELDS)[number];

// Контакт — это ник ИЛИ ссылка на профиль. Ссылку принимаем, только если она ведёт на один из
// этих сайтов: по ней будут кликать другие люди, и подсунуть им чужой (фишинговый) сайт нельзя.
export const CONTACT_SITES: Record<ContactField, { domains: string[] }> = {
  discord: { domains: ['discord.com', 'discord.gg'] },
  steam: { domains: ['steamcommunity.com'] },
  psn: { domains: ['playstation.com', 'psnprofiles.com'] },
  xbox: { domains: ['xbox.com', 'xboxgamertag.com'] },
};

// Ник: 2–37 букв (любого алфавита), цифр, пробелов и знаков _ . - #
// (37 — самый длинный старый ник Discord вида name#1234). Без ':' и '/' — ссылку за ник не выдать.
const NICKNAME = /^[\p{L}\p{N} _.\-#]{2,37}$/u;

export function isNickname(value: string): boolean {
  return NICKNAME.test(value);
}

// Пустое поле тоже годится: контакты необязательны.
export function isValidContact(value: string, domains: readonly string[]): boolean {
  return value === '' || isNickname(value) || isProfileLink(value, domains);
}

// true — это https-ссылка на один из domains или его поддомен (www.steamcommunity.com).
// Сравниваем hostname целиком, а не includes(): иначе прошёл бы 'steamcommunity.com.evil.ru'.
export function isProfileLink(value: string, domains: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false; // вообще не ссылка
  }
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === 'https:' &&
    domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
  );
}

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

// Анкета другого игрока в ленте: та же UserProfile плюс id документа.
export type Player = UserProfile & { uid: string };

// Ссылки на профили — users/{uid}/private/contacts. Отдельный документ, чтобы правила базы могли
// показывать его только после взаимного мэтча (этап 6).
export type UserContacts = Record<ContactField, string>;

// Полных лет на дату today. День рождения в этом году ещё не наступил — минус год.
export function ageFrom(birthDate: string, today = new Date()): number {
  const [year, month, day] = birthDate.split('-').map(Number);
  const hadBirthday =
    today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);
  return today.getFullYear() - year - (hadBirthday ? 0 : 1);
}
