import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth';
import { PendingLikes } from './pending-likes';
import { SwipeService } from './swipes';

// Firestore здесь не нужен: подменяем SwipeService заглушкой и проверяем только очередь —
// когда лайк уходит, когда нет, и что flush() ничего не теряет.
describe('PendingLikes', () => {
  let likes: string[];
  let service: PendingLikes;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem('di-like-outbox');
    likes = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SwipeService,
          useValue: {
            like: async (me: string, other: string) => {
              likes.push(`${me}_${other}`);
              return other === 'fan';
            },
          },
        },
        { provide: AuthService, useValue: { user: signal({ uid: 'me' }) } },
      ],
    });
    service = TestBed.inject(PendingLikes);
  });

  afterEach(() => vi.useRealTimers());

  it('sends the like only after the undo window', async () => {
    const outcome = service.schedule('me', 'bob', 4000);
    await vi.advanceTimersByTimeAsync(3900);
    expect(likes).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(likes).toEqual(['me_bob']);
    await expect(outcome).resolves.toBe('sent');
  });

  it('cancel() drops the like without touching the server', async () => {
    const outcome = service.schedule('me', 'bob', 4000);
    expect(service.cancel('me', 'bob')).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(likes).toEqual([]);
    await expect(outcome).resolves.toBe('cancelled');
  });

  it('pause() stops the countdown until resume()', async () => {
    void service.schedule('me', 'bob', 4000);
    await vi.advanceTimersByTimeAsync(1000);
    service.pause('me', 'bob');
    await vi.advanceTimersByTimeAsync(10000);
    expect(likes).toEqual([]);
    service.resume('me', 'bob');
    await vi.advanceTimersByTimeAsync(3100);
    expect(likes).toEqual(['me_bob']);
  });

  it('flush() sends waiting likes right away and waits for them (logout)', async () => {
    const outcome = service.schedule('me', 'fan', 4000);
    await service.flush(3000);
    expect(likes).toEqual(['me_fan']);
    await expect(outcome).resolves.toBe('matched');
    expect(localStorage.getItem('di-like-outbox')).toBeNull();
  });
});
