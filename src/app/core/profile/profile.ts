import { Injectable, inject } from '@angular/core';
import { FirebaseError } from 'firebase/app';
import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { FIRESTORE } from '../firebase/firestore';
import { UserContacts, UserProfile } from './profile.model';

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly db = inject(FIRESTORE);

  // Читаем оба документа параллельно. null — профиль ещё не создавали.
  async load(uid: string): Promise<{ profile: UserProfile | null; contacts: UserContacts | null }> {
    const [profileSnap, contactsSnap] = await Promise.all([
      getDoc(this.profileDoc(uid)),
      getDoc(this.contactsDoc(uid)),
    ]);
    return {
      profile: profileSnap.exists() ? (profileSnap.data() as UserProfile) : null,
      contacts: contactsSnap.exists() ? (contactsSnap.data() as UserContacts) : null,
    };
  }

  // writeBatch — оба документа сохранятся вместе или не сохранится ни один.
  // serverTimestamp() — время ставит сервер Firebase, а не часы на компьютере пользователя.
  save(uid: string, profile: UserProfile, contacts: UserContacts): Promise<void> {
    const batch = writeBatch(this.db);
    batch.set(this.profileDoc(uid), { ...profile, updatedAt: serverTimestamp() }, { merge: true });
    batch.set(this.contactsDoc(uid), contacts);
    return batch.commit();
  }

  private profileDoc(uid: string) {
    return doc(this.db, 'users', uid);
  }

  private contactsDoc(uid: string) {
    return doc(this.db, 'users', uid, 'private', 'contacts');
  }
}

// Как authErrorKey: код ошибки Firestore → ключ перевода.
export function profileErrorKey(error: unknown): string {
  const code = error instanceof FirebaseError ? error.code : '';
  switch (code) {
    case 'permission-denied':
      return 'profile.errors.permission';
    case 'unavailable':
      return 'profile.errors.network';
    default:
      console.error(error);
      return 'profile.errors.unknown';
  }
}
