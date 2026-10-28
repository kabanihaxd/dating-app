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
import { FirebaseError } from 'firebase/app';
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
// ended — чат был открыт, но мэтч пропал прямо во время разговора (собеседник разорвал мэтч
// или заблокировал). Переписку оставляем на экране «замороженной», а писать уже нельзя.
type ChatState = 'loading' | 'ready' | 'ended' | 'notFound' | 'error';

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
  // Идёт ли сейчас отправка — пока да, второй Enter/нажатие кнопки ничего не делает.
  protected readonly sending = signal(false);
  // Сенсорный ли экран — запоминаем при открытии, чтобы решить, показывать ли подсказку про Enter.
  protected readonly touch = this.isTouch();
  // Текст для программы чтения с экрана: последнее ВХОДЯЩЕЕ сообщение («Аня: привет»).
  // Свои сообщения не озвучиваем — человек их только что сам набрал.
  protected readonly announcement = signal('');

  // Имя собеседника для подписей; если анкета не загрузилась — нейтральное «Игрок».
  protected readonly partnerName = computed(
    () => this.partner()?.name || this.i18n.translate('chat.unknown'),
  );

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
      // Машиночитаемое время для <time datetime="...">: ISO-строка вида 2026-10-28T18:05:00.000Z.
      datetime: message.createdAt?.toISOString() ?? null,
    }));
  });

  protected readonly draft = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(MAX_MESSAGE_LENGTH)],
  });

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private markReadFailed = false;
  // id сообщений, которые уже были на экране, — чтобы озвучивать только действительно новые.
  // null — первый снимок ещё не пришёл (историю при открытии чата не зачитываем).
  private seenIds: Set<string> | null = null;
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
      this.seenIds = null;
      this.announcement.set('');
      this.sending.set(false);
      this.notifications.activeChat.set(matchId);

      void this.loadPartner(matchId);
      // Подписка на сообщения: новые приходят сами, пока страница открыта.
      const unsubscribe = this.chat.watchMessages(
        matchId,
        (messages) => this.onMessages(messages),
        (error) => this.fail(error),
      );
      // Подписка на сам мэтч: если собеседник разорвёт его посреди разговора, узнаем сразу.
      const unsubscribeMatch = this.chat.watchMatch(
        matchId,
        () => this.end(),
        (error) => console.error(error),
      );
      onCleanup(() => {
        unsubscribe();
        unsubscribeMatch();
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
    if (!text || this.draft.invalid || this.sending() || this.state() !== 'ready') {
      return;
    }
    // Поле очищаем сразу, не дожидаясь сервера: Firestore и так мгновенно покажет сообщение
    // в списке (из локального кэша). Если отправка не удалась — возвращаем текст в поле.
    // sending снимается, как только сообщение появилось в списке (см. onMessages) или запись
    // завершилась. Ждать только ответа сервера нельзя: без сети он не придёт никогда,
    // и человек не смог бы отправить второе сообщение офлайн.
    this.sending.set(true);
    this.draft.reset();
    try {
      await this.chat.send(this.matchId(), this.me, text);
    } catch (error) {
      console.error(error);
      if (this.isMatchGone(error)) {
        // Нет доступа или документа — мэтча уже нет. Это не «проблема с сетью», а конец чата.
        this.end();
      } else {
        this.draft.setValue(text);
        this.snackBar.open(this.i18n.translate('chat.sendError'), undefined, { duration: 4000 });
      }
    } finally {
      this.sending.set(false);
    }
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  // Мэтч разорван или собеседник заблокирован — чата больше нет, возвращаемся к списку мэтчей.
  protected leave(): void {
    void this.router.navigateByUrl('/matches');
  }

  // На компьютере Enter отправляет, Shift+Enter — перенос строки (как в мессенджерах).
  // На телефоне (сенсорный экран, pointer: coarse) Enter — просто новая строка, а отправляют кнопкой:
  // по экранной клавиатуре легко промахнуться, а отправленное сообщение уже не вернуть.
  // isComposing — человек ещё набирает символ через IME (китайский, японский, корейский ввод):
  // такой Enter подтверждает выбор иероглифа, а не отправляет сообщение.
  protected onEnter(event: Event): void {
    const keyboard = event as KeyboardEvent;
    if (keyboard.isComposing || keyboard.shiftKey || this.isTouch()) {
      return;
    }
    event.preventDefault();
    void this.send();
  }

  private isTouch(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  // Новый снимок переписки. Здесь три задачи: не трогать «замороженный» завершённый чат;
  // заметить, что сообщения начали исчезать (их стирают перед удалением мэтча);
  // и подготовить озвучку для новых входящих.
  private onMessages(messages: ChatMessage[]): void {
    if (this.state() === 'ended') {
      return;
    }
    // По одному сообщения в этом приложении никто не удаляет — их стирают только вместе с мэтчем
    // (разрыв или блокировка). Значит, если сообщений стало меньше, чат завершается: оставляем
    // на экране то, что было, а не мелькаем пустым экраном «Поздоровайся».
    if (this.state() === 'ready' && messages.length < this.messages().length) {
      this.end();
      return;
    }
    this.messages.set(messages);
    this.sending.set(false);

    const seen = this.seenIds;
    if (seen) {
      const last = messages.filter((m) => m.from !== this.me && !seen.has(m.id)).at(-1);
      if (last) {
        const speaker = this.i18n.translate('chat.speaker.partner', { name: this.partnerName() });
        this.announcement.set(`${speaker} ${last.text}`);
      }
    }
    this.seenIds = new Set(messages.map((m) => m.id));
  }

  // Чат завершён посреди разговора. Срабатывает только для уже открытого чата: если мэтча нет
  // с самого начала, это решает loadPartner (состояние notFound).
  private end(): void {
    if (this.state() === 'ready') {
      this.state.set('ended');
      this.sending.set(false);
    }
  }

  // permission-denied — правила не пускают (мэтча нет), not-found — обновлять уже нечего.
  private isMatchGone(error: unknown): boolean {
    return (
      isPermissionDenied(error) || (error instanceof FirebaseError && error.code === 'not-found')
    );
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
  // Если чат уже был открыт, ошибка доступа значит одно: мэтч удалили — чат завершён.
  private fail(error: unknown): void {
    // Завершённый чат «заморожен»: ошибки отписавшихся подписок ему уже не важны.
    if (this.state() === 'ended') {
      return;
    }
    if (this.state() === 'ready' && isPermissionDenied(error)) {
      this.end();
      return;
    }
    if (isPermissionDenied(error)) {
      this.state.set('notFound');
    } else {
      this.errorKey.set(firestoreErrorKey(error));
      this.state.set('error');
    }
  }
}
