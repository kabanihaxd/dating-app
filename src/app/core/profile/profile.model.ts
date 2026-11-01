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

// Платформы, жанры и время — всегда в порядке каталога (PC, PlayStation, Xbox…), а не в том,
// в каком их отметил человек. Иначе одна и та же пара выходила «PlayStation, PC» в карточке чата
// и «PC · PlayStation» на странице мэтчей.
export function inCatalogOrder<T>(items: readonly T[], catalog: readonly T[]): T[] {
  return [...items].sort((a, b) => catalog.indexOf(a) - catalog.indexOf(b));
}
export type Genre = (typeof GENRES)[number];
export type PlayTime = (typeof PLAY_TIMES)[number];

// Подсказки для поля «Игры». Названия игр не переводим, и можно вписать любую свою.
export const POPULAR_GAMES = [
  'Among Us',
  'Apex Legends',
  "Baldur's Gate 3",
  'Call of Duty: Warzone',
  'Counter-Strike 2',
  'Cyberpunk 2077',
  'Dead by Daylight',
  'Dead Island 2',
  'Deep Rock Galactic',
  'Destiny 2',
  'Diablo IV',
  'Dota 2',
  'EA Sports FC',
  'Elden Ring',
  'Escape from Tarkov',
  'Final Fantasy XIV',
  'Fortnite',
  'Genshin Impact',
  'GTA V',
  'Hearthstone',
  'Helldivers 2',
  'Hollow Knight',
  'It Takes Two',
  'League of Legends',
  'Lethal Company',
  'Marvel Rivals',
  'Minecraft',
  'Monster Hunter Wilds',
  'Overwatch 2',
  'Path of Exile 2',
  'PUBG: Battlegrounds',
  'Rainbow Six Siege',
  'Roblox',
  'Rocket League',
  'Rust',
  'Sea of Thieves',
  'Stardew Valley',
  'Terraria',
  'The Finals',
  'The Witcher 3',
  'Valheim',
  'Valorant',
  'Warframe',
  'World of Warcraft',
];

// Как игроки на самом деле пишут игры из каталога. Ключ — в нижнем регистре и без лишних пробелов
// (см. normalizeGameText). Значение — название ровно как в POPULAR_GAMES.
const GAME_ALIASES: Record<string, string> = {
  apex: 'Apex Legends',
  bg3: "Baldur's Gate 3",
  'baldurs gate 3': "Baldur's Gate 3",
  warzone: 'Call of Duty: Warzone',
  'cod warzone': 'Call of Duty: Warzone',
  'cod: warzone': 'Call of Duty: Warzone',
  cs2: 'Counter-Strike 2',
  'cs 2': 'Counter-Strike 2',
  'cs:go': 'Counter-Strike 2',
  csgo: 'Counter-Strike 2',
  'counter strike 2': 'Counter-Strike 2',
  'counter-strike': 'Counter-Strike 2',
  'counter strike': 'Counter-Strike 2',
  cyberpunk: 'Cyberpunk 2077',
  dbd: 'Dead by Daylight',
  drg: 'Deep Rock Galactic',
  dota: 'Dota 2',
  dota2: 'Dota 2',
  'diablo 4': 'Diablo IV',
  d4: 'Diablo IV',
  'fc 24': 'EA Sports FC',
  'fc 25': 'EA Sports FC',
  fifa: 'EA Sports FC',
  'ea fc': 'EA Sports FC',
  'elden ring nightreign': 'Elden Ring',
  tarkov: 'Escape from Tarkov',
  eft: 'Escape from Tarkov',
  ffxiv: 'Final Fantasy XIV',
  ff14: 'Final Fantasy XIV',
  genshin: 'Genshin Impact',
  'gta 5': 'GTA V',
  gta5: 'GTA V',
  'gta online': 'GTA V',
  'grand theft auto v': 'GTA V',
  'grand theft auto 5': 'GTA V',
  hs: 'Hearthstone',
  helldivers: 'Helldivers 2',
  lol: 'League of Legends',
  'monster hunter': 'Monster Hunter Wilds',
  'mh wilds': 'Monster Hunter Wilds',
  ow2: 'Overwatch 2',
  overwatch: 'Overwatch 2',
  poe2: 'Path of Exile 2',
  'poe 2': 'Path of Exile 2',
  pubg: 'PUBG: Battlegrounds',
  'pubg battlegrounds': 'PUBG: Battlegrounds',
  r6: 'Rainbow Six Siege',
  r6s: 'Rainbow Six Siege',
  'rainbow six': 'Rainbow Six Siege',
  "tom clancy's rainbow six siege": 'Rainbow Six Siege',
  rl: 'Rocket League',
  sot: 'Sea of Thieves',
  witcher: 'The Witcher 3',
  'witcher 3': 'The Witcher 3',
  wow: 'World of Warcraft',
};

// Короче этого своё название не принимаем: «Hal» — почти всегда недописанная подсказка, а не игра.
export const MIN_CUSTOM_GAME_LENGTH = 3;

function normalizeGameText(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

const CATALOG_BY_KEY = new Map(POPULAR_GAMES.map((game) => [normalizeGameText(game), game]));

// Название из каталога для того, что набрал игрок («cs2», «dota 2 », «WoW»), или null, если такой игры
// в каталоге нет. Тогда игра своя: её сохраняем как набрали, только без лишних пробелов.
export function catalogGame(name: string): string | null {
  const key = normalizeGameText(name);
  return CATALOG_BY_KEY.get(key) ?? GAME_ALIASES[key] ?? null;
}

// Ключ для сравнения игр двух игроков. Старые анкеты могут хранить «CS2» или «dota 2» —
// сравниваем по каталожному названию, так они всё равно совпадут с «Counter-Strike 2» и «Dota 2».
export function gameKey(name: string): string {
  return normalizeGameText(catalogGame(name) ?? name);
}

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
