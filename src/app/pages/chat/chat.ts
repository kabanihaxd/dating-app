import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../core/auth/auth';
import { ChatMessage, ChatService, MAX_MESSAGE_LENGTH } from '../../core/chat/chat';
import { firestoreErrorKey, isPermissionDenied } from '../../core/firebase/firestore-errors';
import { I18n } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { matchScore } from '../../core/matching/match-score';
import { NotificationService } from '../../core/notifications/notifications';
import { ProfileService } from '../../core/profile/profile';
import { UserProfile } from '../../core/profile/profile.model';
import { ErrorState } from '../../shared/error-state/error-state';
import { ModerationMenu } from '../../shared/moderation-menu/moderation-menu';
import { StateMessage } from '../../shared/state-message/state-message';

// notFound — мэтча нет или он чужой; error — не загрузилось (например, нет сети), можно повторить.
type ChatState = 'loading' | 'ready' | 'notFound' | 'error';

@Component({
  selector: 'app-chat',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TextFieldModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TranslatePipe,
    ModerationMenu,
    ErrorState,
    StateMessage,
  ],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
})
export class Chat {
  private readonly auth = inject(AuthService);
  private readonly chat = inject(ChatService);
  private readonly profiles = inject(ProfileService);
  private readonly notifications = inject(NotificationService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18n);
  private readonly router = inject(Router);

  // id мэтча из адреса /chat/:matchId. Роутер сам кладёт параметр в input (withComponentInputBinding).
  // Если из одного чата перейти в другой, Angular переиспользует компонент и просто меняет input —
  // поэтому всё, что зависит от matchId, делаем в effect, а не один раз в конструкторе.
  readonly matchId = input.required<string>();

  // Страница закрыта authGuard, поэтому пользователь здесь всегда есть.
  private readonly me = this.auth.user()!.uid;

  protected readonly maxLength = MAX_MESSAGE_LENGTH;
  protected readonly state = signal<ChatState>('loading');
  protected readonly errorKey = signal('errors.unknown');
  // Пузыри-заготовки для скелетона: чьё сообщение и какой ширины (в %).
  protected readonly skeletonBubbles = [
    { mine: false, width: 55 },
    { mine: true, width: 40 },
    { mine: false, width: 70 },
    { mine: true, width: 50 },
  ];
  protected readonly partner = signal<UserProfile | null>(null);
  protected readonly partnerUid = signal<string | null>(null);
  protected readonly commonGames = signal<string[]>([]);
  private readonly messages = signal<ChatMessage[]>([]);

  // Сообщения в том виде, в каком их рисует шаблон. Время — в формате выбранного языка сайта.
  protected readonly messageViews = computed(() => {
    const format = new Intl.DateTimeFormat(this.i18n.lang(), {
      hour: '2-digit',
      minute: '2-digit',
    });
    return this.messages().map((message) => ({
      id: message.id,
      text: message.text,
      mine: message.from === this.me,
      time: message.createdAt ? format.format(message.createdAt) : '',
    }));
  });

  protected readonly draft = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(MAX_MESSAGE_LENGTH)],
  });

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private markReadFailed = false;
  // «Спробувати ще раз» увеличивает счётчик — effect ниже читает его и запускается заново.
  private readonly attempt = signal(0);

  constructor() {
    effect((onCleanup) => {
      const matchId = this.matchId();
      this.attempt();
      this.state.set('loading');
      this.messages.set([]);
      this.partnerUid.set(null);
      this.markReadFailed = false;
      this.notifications.activeChat.set(matchId);

      void this.loadPartner(matchId);
      // Подписка на сообщения: новые приходят сами, пока страница открыта.
      const unsubscribe = this.chat.watchMessages(
        matchId,
        (messages) => this.messages.set(messages),
        (error) => this.fail(error),
      );
      onCleanup(() => {
        unsubscribe();
        this.notifications.activeChat.set(null);
      });
    });

    // Пока чат открыт, всё пришедшее сразу прочитано: значок непрочитанного гаснет
    // и у меня, и в превью на странице «Мэтчи». Ошибку не повторяем, чтобы не зациклиться.
    effect(() => {
      const matchId = this.matchId();
      if (
        this.state() === 'ready' &&
        this.notifications.unreadChats().has(matchId) &&
        !this.markReadFailed
      ) {
        this.chat.markRead(matchId, this.me).catch((error) => {
          this.markReadFailed = true;
          console.error(error);
        });
      }
    });

    // afterRenderEffect срабатывает ПОСЛЕ того, как Angular нарисовал новые сообщения, —
    // тогда высота списка уже новая, и можно прокрутить его в самый низ.
    afterRenderEffect(() => {
      this.messageViews();
      const list = this.list()?.nativeElement;
      if (list) {
        list.scrollTop = list.scrollHeight;
      }
    });
  }

  protected async send(): Promise<void> {
    const text = this.draft.value.trim();
    if (!text || this.draft.invalid) {
      return;
    }
    // Поле очищаем сразу, не дожидаясь сервера: Firestore и так мгновенно покажет сообщение
    // в списке (из локального кэша). Если отправка не удалась — возвращаем текст в поле.
    this.draft.reset();
    try {
      await this.chat.send(this.matchId(), this.me, text);
    } catch (error) {
      console.error(error);
      this.draft.setValue(text);
      this.snackBar.open(this.i18n.translate('chat.sendError'), undefined, { duration: 4000 });
    }
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  // Мэтч разорван или собеседник заблокирован — чата больше нет, возвращаемся к списку мэтчей.
  protected leave(): void {
    void this.router.navigateByUrl('/matches');
  }

  // Enter отправляет, Shift+Enter — перенос строки (как в мессенджерах).
  protected onEnter(event: Event): void {
    if (!(event as KeyboardEvent).shiftKey) {
      event.preventDefault();
      void this.send();
    }
  }

  private async loadPartner(matchId: string): Promise<void> {
    let partnerUid: string | null;
    try {
      partnerUid = await this.chat.loadPartner(matchId, this.me);
    } catch (error) {
      if (matchId === this.matchId()) {
        this.fail(error);
      }
      return;
    }
    if (!partnerUid) {
      if (matchId === this.matchId()) {
        this.state.set('notFound');
      }
      return;
    }
    // Анкеты нужны только для красоты (имя, фото, общие игры) — без них чат всё равно работает.
    const [partner, myProfile] = await Promise.all([
      this.profiles.loadPublic(partnerUid).catch(() => null),
      this.profiles.loadPublic(this.me).catch(() => null),
    ]);
    // Пока грузили, пользователь мог уйти в другой чат — тогда этот результат уже не нужен.
    if (matchId !== this.matchId()) {
      return;
    }
    this.partner.set(partner);
    this.partnerUid.set(partnerUid);
    this.commonGames.set(partner && myProfile ? matchScore(myProfile, partner).commonGames : []);
    this.state.set('ready');
  }

  // Ошибка доступа — мэтча нет или он чужой (так решают firestore.rules). Остальное — повод повторить.
  private fail(error: unknown): void {
    if (isPermissionDenied(error)) {
      this.state.set('notFound');
    } else {
      this.errorKey.set(firestoreErrorKey(error));
      this.state.set('error');
    }
  }
}
