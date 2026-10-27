// Тестовые игроки для ленты, чтобы было что смотреть, пока на сайте нет настоящих людей.
//
//   node scripts/seed-test-players.mts           — создать (или обновить) тестовых игроков
//   node scripts/seed-test-players.mts --delete  — удалить их аккаунты, анкеты, лайки, мэтчи и чаты
//   node scripts/seed-test-players.mts --chat    — тестовые игроки пишут «привет» во все свои мэтчи
//                                                  (открой чат в браузере — сообщение появится само)
//
// Каждый второй тестовый игрок (Аня, Катя, Лера, Оля) лайкает всех настоящих пользователей —
// лайкни кого-то из них в ленте, и сразу получится мэтч.
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
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore/lite';
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
const emailOf = (index: number) => `test-player-${index + 1}@deadisland.test`;

// Удаляем всё, что создал тестовый игрок: лайки, пропуски, мэтчи, контакты, анкету и сам аккаунт.
async function removePlayer(index: number): Promise<void> {
  const { user } = await signInWithEmailAndPassword(auth, emailOf(index), PASSWORD);
  const own = await Promise.all([
    getDocs(query(collection(db, 'likes'), where('from', '==', user.uid))),
    getDocs(query(collection(db, 'skips'), where('from', '==', user.uid))),
    getDocs(query(collection(db, 'matches'), where('users', 'array-contains', user.uid))),
  ]);
  // Сначала переписка: Firestore НЕ удаляет вложенную коллекцию messages вместе с мэтчем.
  for (const match of own[2].docs) {
    for (const message of (await getDocs(collection(match.ref, 'messages'))).docs) {
      await deleteDoc(message.ref);
    }
  }
  for (const snapshot of own) {
    for (const item of snapshot.docs) {
      await deleteDoc(item.ref);
    }
  }
  await deleteDoc(doc(db, 'users', user.uid, 'private', 'contacts'));
  await deleteDoc(doc(db, 'users', user.uid));
  await deleteUser(user);
}

if (process.argv.includes('--delete')) {
  for (const [index, player] of players.entries()) {
    try {
      await removePlayer(index);
      console.log(`✗ удалён ${player.name} (${emailOf(index)})`);
    } catch {
      console.log(`- ${emailOf(index)} не найден, пропускаем`);
    }
  }
  process.exit(0);
}

const greetings = [
  'Привіт! Бачу, ти теж граєш — зіграємо сьогодні ввечері? 🎮',
  'Hi! GG on the match 😄 What are you playing these days?',
  'Привіт 👋 Яка твоя улюблена гра всіх часів?',
  'Ahoj! Máš mikrofón? Poďme si zahrať 🙂',
];

// Тестовый игрок пишет в каждый свой мэтч — как будто ответил живой человек.
// Сообщение и превью lastMessage — одним batch, как в ChatService.send().
async function sendGreetings(index: number): Promise<number> {
  const { user } = await signInWithEmailAndPassword(auth, emailOf(index), PASSWORD);
  const matches = await getDocs(
    query(collection(db, 'matches'), where('users', 'array-contains', user.uid)),
  );
  for (const match of matches.docs) {
    const message = {
      from: user.uid,
      text: greetings[index % greetings.length],
      createdAt: serverTimestamp(),
    };
    const batch = writeBatch(db);
    batch.set(doc(collection(match.ref, 'messages')), message);
    batch.update(match.ref, { lastMessage: message });
    await batch.commit();
  }
  await signOut(auth);
  return matches.size;
}

if (process.argv.includes('--chat')) {
  for (const [index, player] of players.entries()) {
    const sent = await sendGreetings(index).catch((error) => {
      console.log(`✗ ${player.name}: ${error.code ?? error}`);
      return 0;
    });
    if (sent) {
      console.log(`💬 ${player.name} сообщений в чаты: ${sent}`);
    }
  }
  process.exit(0);
}

// Шаг 1: аккаунты и анкеты. Аккаунт уже есть (скрипт запускали раньше) — входим и обновляем анкету.
const testUids = new Set<string>();
for (const [index, player] of players.entries()) {
  const email = emailOf(index);
  const { user } = await createUserWithEmailAndPassword(auth, email, PASSWORD).catch(() =>
    signInWithEmailAndPassword(auth, email, PASSWORD),
  );
  await setDoc(doc(db, 'users', user.uid), {
    ...player,
    photo: null,
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'users', user.uid, 'private', 'contacts'), {
    discord: `https://discord.com/users/10000000000000000${index + 1}`,
    steam: `https://steamcommunity.com/id/deadisland-test-${index + 1}`,
    psn: index % 3 === 0 ? `di_tester_${index + 1}` : '',
    xbox: '',
  });
  testUids.add(user.uid);
  await signOut(auth);
  console.log(`✓ ${player.name} (${email})`);
}

// Шаг 2: каждый второй тестовый игрок лайкает всех настоящих пользователей.
// Лайк можно только создать (не перезаписать), поэтому уже поставленные пропускаем.
for (const [index, player] of players.entries()) {
  if (index % 2 !== 0) {
    continue;
  }
  const { user } = await signInWithEmailAndPassword(auth, emailOf(index), PASSWORD);
  const realUsers = (await getDocs(collection(db, 'users'))).docs.filter(
    (u) => !testUids.has(u.id),
  );
  for (const other of realUsers) {
    const like = doc(db, 'likes', `${user.uid}_${other.id}`);
    if (!(await getDoc(like)).exists()) {
      await setDoc(like, { from: user.uid, to: other.id, createdAt: serverTimestamp() });
    }
  }
  await signOut(auth);
  console.log(`♥ ${player.name} лайкнула настоящих игроков: ${realUsers.length}`);
}

process.exit(0);
