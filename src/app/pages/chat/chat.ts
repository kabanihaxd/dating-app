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
import { RouterLink } from '@angular/router';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../core/auth/auth';
import { ChatMessage, ChatService, MAX_MESSAGE_LENGTH } from '../../core/chat/chat';
import { I18n } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { matchScore } from '../../core/matching/match-score';
import { NotificationService } from '../../core/notifications/notifications';
import { ProfileService } from '../../core/profile/profile';
import { UserProfile } from '../../core/profile/profile.model';

type ChatState = 'loading' | 'ready' | 'notFound';

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
    MatProgressSpinnerModule,
    TranslatePipe,
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

  // id мэтча из адреса /chat/:matchId. Роутер сам кладёт параметр в input (withComponentInputBinding).
  // Если из одного чата перейти в другой, Angular переиспользует компонент и просто меняет input —
  // поэтому всё, что зависит от matchId, делаем в effect, а не один раз в конструкторе.
  readonly matchId = input.required<string>();

  // Страница закрыта authGuard, поэтому пользователь здесь всегда есть.
  private readonly me = this.auth.user()!.uid;

  protected readonly maxLength = MAX_MESSAGE_LENGTH;
  protected readonly state = signal<ChatState>('loading');
  protected readonly partner = signal<UserProfile | null>(null);
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

  constructor() {
    effect((onCleanup) => {
      const matchId = this.matchId();
      this.state.set('loading');
      this.messages.set([]);
      this.markReadFailed = false;
      this.notifications.activeChat.set(matchId);

      void this.loadPartner(matchId);
      // Подписка на сообщения: новые приходят сами, пока страница открыта.
      // Ошибка доступа — значит, мэтча нет или он чужой (так решают firestore.rules).
      const unsubscribe = this.chat.watchMessages(
        matchId,
        (messages) => this.messages.set(messages),
        () => this.state.set('notFound'),
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

  // Enter отправляет, Shift+Enter — перенос строки (как в мессенджерах).
  protected onEnter(event: Event): void {
    if (!(event as KeyboardEvent).shiftKey) {
      event.preventDefault();
      void this.send();
    }
  }

  private async loadPartner(matchId: string): Promise<void> {
    const partnerUid = await this.chat.loadPartner(matchId, this.me);
    if (!partnerUid) {
      this.state.set('notFound');
      return;
    }
    const [partner, myProfile] = await Promise.all([
      this.profiles.loadPublic(partnerUid).catch(() => null),
      this.profiles.loadPublic(this.me).catch(() => null),
    ]);
    // Пока грузили, пользователь мог уйти в другой чат — тогда этот результат уже не нужен.
    if (matchId !== this.matchId()) {
      return;
    }
    this.partner.set(partner);
    this.commonGames.set(partner && myProfile ? matchScore(myProfile, partner).commonGames : []);
    this.state.set('ready');
  }
}
