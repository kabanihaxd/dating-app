// Тестовые игроки для ленты, чтобы было что смотреть, пока на сайте нет настоящих людей.
//
//   node scripts/seed-test-players.mts           — создать (или обновить) тестовых игроков
//   node scripts/seed-test-players.mts --delete  — удалить их аккаунты и анкеты
//
// Скрипт работает как обычный пользователь сайта: регистрирует аккаунт и пишет свою анкету,
// поэтому правила Firestore для него те же, что и для браузера. Node 24 запускает .mts без сборки.
import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { deleteDoc, doc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore/lite';
import { firebaseConfig } from '../src/app/core/firebase/firebase.config.ts';

const PASSWORD = 'test-player-123';

const players = [
  {
    name: 'Аня',
    birthDate: '1999-04-12',
    city: 'Київ',
    bio: 'Хілю в Overwatch, вечорами — Baldur’s Gate 3 в коопі. Шукаю тіммейта і не тільки 😉',
    games: ['Overwatch 2', "Baldur's Gate 3", 'Stardew Valley'],
    platforms: ['pc', 'switch'],
    genres: ['shooter', 'rpg', 'indie'],
    playTimes: ['evening', 'weekends'],
  },
  {
    name: 'Max',
    birthDate: '1995-11-03',
    city: 'Bratislava',
    bio: 'CS2 faceit lvl 8. Looking for someone who doesn’t rage quit.',
    games: ['Counter-Strike 2', 'Valorant', 'Rust'],
    platforms: ['pc'],
    genres: ['shooter', 'survival'],
    playTimes: ['night', 'weekdays'],
  },
  {
    name: 'Катя',
    birthDate: '2001-08-21',
    city: 'Львів',
    bio: 'Elden Ring пройшла тричі. Тепер шукаю, з ким пройти Dead Island 2.',
    games: ['Elden Ring', 'Dead Island 2', 'The Witcher 3', 'Dead by Daylight'],
    platforms: ['playstation', 'pc'],
    genres: ['rpg', 'horror', 'survival'],
    playTimes: ['evening', 'night'],
  },
  {
    name: 'Denis',
    birthDate: '1992-02-14',
    city: 'Košice',
    bio: 'Dota 2 od roku 2013. Hľadám support do dvojice.',
    games: ['Dota 2', 'League of Legends', 'World of Warcraft'],
    platforms: ['pc'],
    genres: ['moba', 'mmo', 'strategy'],
    playTimes: ['evening', 'weekends'],
  },
  {
    name: 'Лера',
    birthDate: '1998-06-30',
    city: 'Одеса',
    bio: 'Майнкрафт-архітекторка і фанатка уютних ігор.',
    games: ['Minecraft', 'Stardew Valley', 'Valheim'],
    platforms: ['pc', 'switch', 'mobile'],
    genres: ['sandbox', 'indie', 'survival'],
    playTimes: ['morning', 'weekends'],
  },
  {
    name: 'Artem',
    birthDate: '1997-12-09',
    city: 'Kyiv',
    bio: 'Helldivers 2 and Apex. Mic on, toxicity off.',
    games: ['Helldivers 2', 'Apex Legends', 'Fortnite', 'Destiny 2'],
    platforms: ['playstation', 'xbox'],
    genres: ['shooter'],
    playTimes: ['night', 'weekends'],
  },
  {
    name: 'Оля',
    birthDate: '2000-03-05',
    city: 'Харків',
    bio: 'Genshin щодня, Cyberpunk для душі.',
    games: ['Genshin Impact', 'Cyberpunk 2077', 'Elden Ring'],
    platforms: ['mobile', 'playstation'],
    genres: ['rpg'],
    playTimes: ['day', 'evening'],
  },
  {
    name: 'Tomáš',
    birthDate: '1994-09-17',
    city: 'Žilina',
    bio: 'Rocket League a EA FC s kamošmi. Hľadám niekoho na gauč-koop.',
    games: ['Rocket League', 'EA Sports FC', 'GTA V'],
    platforms: ['playstation', 'pc'],
    genres: ['sports', 'racing'],
    playTimes: ['evening', 'weekdays'],
  },
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const shouldDelete = process.argv.includes('--delete');

for (const [index, player] of players.entries()) {
  const email = `test-player-${index + 1}@deadisland.test`;

  if (shouldDelete) {
    try {
      const { user } = await signInWithEmailAndPassword(auth, email, PASSWORD);
      await deleteDoc(doc(db, 'users', user.uid, 'private', 'contacts'));
      await deleteDoc(doc(db, 'users', user.uid));
      await deleteUser(user);
      console.log(`✗ удалён ${player.name} (${email})`);
    } catch {
      console.log(`- ${email} не найден, пропускаем`);
    }
    continue;
  }

  // Аккаунт уже есть (скрипт запускали раньше) — просто входим и обновляем анкету.
  const { user } = await createUserWithEmailAndPassword(auth, email, PASSWORD).catch(() =>
    signInWithEmailAndPassword(auth, email, PASSWORD),
  );
  await setDoc(doc(db, 'users', user.uid), { ...player, photo: null, updatedAt: serverTimestamp() });
  await setDoc(doc(db, 'users', user.uid, 'private', 'contacts'), {
    discord: `https://discord.com/users/10000000000000000${index + 1}`,
    steam: `https://steamcommunity.com/id/deadisland-test-${index + 1}`,
    psn: '',
    xbox: '',
  });
  await signOut(auth);
  console.log(`✓ ${player.name} (${email})`);
}

process.exit(0);
