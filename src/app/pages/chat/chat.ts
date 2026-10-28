import {
  Component,
  DestroyRef,
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
import { AuthService } from '../../core/auth/auth';
import { FirebaseError } from 'firebase/app';
import { ChatMessage, ChatService, MAX_MESSAGE_LENGTH } from '../../core/chat/chat';
import {
  firestoreErrorKey,
  isNetworkErrorKey,
  isPermissionDenied,
} from '../../core/firebase/firestore-errors';
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

// Одна «порция» озвучки для живой области. key — id последнего озвучиваемого сообщения:
// шаблон рисует порцию через @for с track по key, поэтому каждая новая порция — это НОВЫЙ
// элемент в DOM. Программа чтения с экрана замечает вставку и читает её, даже если текст
// дословно совпадает с прошлым («ок», «ок») — простая замена одинакового текста была бы «тишиной».
interface Announcement {
  key: string;
  lines: string[];
}

// Сколько ждём перехода на /matches после своего «Разорвать мэтч»/«Заблокировать».
// Если за это время перехода не было — действие, видимо, не удалось (ошибку покажет само меню),
// и чат снова должен реагировать на настоящее завершение.
const LEAVING_TIMEOUT_MS = 15000;

// «Почти внизу» — до низа списка осталось меньше этого (в пикселях). Ровно 0 требовать нельзя:
// поле ввода, вырастая на строку, чуть сдвигает низ, и человек «внизу» оказался бы «не внизу».
const NEAR_BOTTOM_PX = 80;

// Моё сообщение, которое сервер ОТКЛОНИЛ (правила, ошибка записи). Firestore в этом случае
// сам убирает его из списка (откатывает локальную запись), поэтому храним его отдельно —
// чтобы человек видел, что именно не ушло, и мог отправить ещё раз одной кнопкой.
// Без сети запись не отклоняется, а просто ждёт: такое сообщение остаётся в списке с «часиками».
interface FailedMessage {
  id: string;
  text: string;
}

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
  // Идёт ли сейчас отправка — пока да, второй Enter/нажатие кнопки ничего не делает (см. send).
  // Кнопку по нему НЕ выключаем: выключенная кнопка теряет фокус, и на телефоне закрывается клавиатура.
  private readonly sending = signal(false);
  // Сенсорный ли экран — запоминаем при открытии, чтобы решить, показывать ли подсказку про Enter.
  protected readonly touch = this.isTouch();
  // Озвучка для программы чтения с экрана: новые ВХОДЯЩИЕ сообщения («Аня: привет»).
  // Свои сообщения не озвучиваем — человек их только что сам набрал.
  // Массив из 0 или 1 элемента — так шаблон может пересоздать элемент по key (см. Announcement).
  protected readonly announcement = signal<Announcement[]>([]);
  // Неотправленные сообщения (см. FailedMessage) — рисуются в конце переписки с кнопкой «Повторить».
  protected readonly failed = signal<FailedMessage[]>([]);
  // Плашка «Новые сообщения ↓»: пришло входящее, а человек в этот момент листал историю выше.
  // Прокручивать его вниз силой нельзя — он потеряет место, где читал.
  protected readonly newBelow = signal(false);

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
      // Состояние доставки показываем только у своих: «часики» — ждём сервер, галочка — записано.
      pending: message.pending,
    }));
  });

  protected readonly draft = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(MAX_MESSAGE_LENGTH)],
  });

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('input');
  private markReadFailed = false;
  // id сообщений, которые уже были на экране, — чтобы озвучивать только действительно новые.
  // null — «точки отсчёта» ещё нет (историю при открытии чата не зачитываем).
  private seenIds: Set<string> | null = null;
  // Время самого нового из уже виденных сообщений. Подстраховка к seenIds: если сервер дослал
  // СТАРЫЕ сообщения, которых не было в кэше, они не новые — их не озвучиваем.
  private seenUntil = 0;
  // Чат, для которого сейчас всё настроено: по нему effect понимает, что сменился именно мэтч,
  // а не просто нажали «Попробовать ещё раз».
  private loadedMatchId: string | null = null;
  // Я сам разрываю мэтч или блокирую собеседника: исчезновение мэтча — ожидаемое следствие,
  // показывать «Чат завершён» (и озвучивать это) не нужно — сейчас уйдём на /matches.
  private leaving = false;
  private leavingTimer: ReturnType<typeof setTimeout> | undefined;
  // Пока я «ухожу», признаки завершения глушим. Если уход не удался — их надо перепроверить.
  private endSuppressed = false;
  // Идёт ли проверка «а мэтч точно удалён?» и какой снимок переписки применить, если нет.
  private verifying = false;
  private pendingMessages: ChatMessage[] | null = null;
  // «Спробувати ще раз» увеличивает счётчик — effect ниже читает его и запускается заново.
  private readonly attempt = signal(0);
  // Для прокрутки: какой элемент списка мы уже прокрутили (новый элемент = чат только что открылся),
  // какое сообщение было последним и сколько было неотправленных — так afterRenderEffect понимает,
  // что именно изменилось: пришло новое сообщение или у старого просто сменились «часики» на галочку.
  private scrolledList: HTMLElement | null = null;
  private lastTailId: string | null = null;
  private lastFailedCount = 0;
  // Был ли человек внизу списка ДО того, как пришло новое сообщение. Обновляется на каждой
  // прокрутке (onScroll): после отрисовки нового пузыря «до низа» уже больше, и мерить поздно.
  private nearBottom = true;
  private failedSeq = 0;

  constructor() {
    effect((onCleanup) => {
      const matchId = this.matchId();
      this.attempt();
      // Перешли в ДРУГОЙ чат (компонент тот же): всё, что относилось к прошлому собеседнику,
      // стираем — иначе недописанный текст «утёк» бы в чужую переписку, а в шапке мелькнуло бы
      // старое имя. При повторе того же чата черновик, наоборот, сохраняем.
      if (matchId !== this.loadedMatchId) {
        this.loadedMatchId = matchId;
        this.draft.reset();
        this.partner.set(null);
        this.commonGames.set([]);
        // Неотправленные сообщения относятся к тому чату, где их писали.
        this.failed.set([]);
        this.stopLeaving();
      }
      this.state.set('loading');
      this.messages.set([]);
      this.partnerUid.set(null);
      this.markReadFailed = false;
      this.seenIds = null;
      this.seenUntil = 0;
      this.announcement.set([]);
      this.sending.set(false);
      this.verifying = false;
      this.pendingMessages = null;
      this.endSuppressed = false;
      this.newBelow.set(false);
      // Прокрутку отдельно сбрасывать не нужно: в состоянии loading список удаляется из DOM,
      // а новый после загрузки сам прокручивается в самый низ (afterRenderEffect ниже узнаёт
      // его как «новый элемент»).
      this.notifications.activeChat.set(matchId);

      void this.loadPartner(matchId);
      // Подписка на сообщения: новые приходят сами, пока страница открыта.
      const unsubscribe = this.chat.watchMessages(
        matchId,
        (messages, fromCache) => this.onMessages(matchId, messages, fromCache),
        (error) => this.fail(matchId, error),
      );
      // Подписка на сам мэтч: если собеседник разорвёт его посреди разговора, узнаем сразу.
      const unsubscribeMatch = this.chat.watchMatch(
        matchId,
        () => this.end(),
        // Ошибка доступа обычно значит «мэтч удалён», но проверяем это отдельным запросом.
        (error) => (isPermissionDenied(error) ? this.verifyEnded(matchId) : console.error(error)),
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
    // тогда высота списка уже новая, и можно решать, прокручивать ли его вниз.
    afterRenderEffect(() => {
      const views = this.messageViews();
      const failedCount = this.failed().length;
      const list = this.list()?.nativeElement;
      if (!list) {
        this.scrolledList = null;
        return;
      }
      const tail = views.at(-1);
      const tailId = tail?.id ?? null;
      const opened = list !== this.scrolledList;
      const newTail = tailId !== this.lastTailId;
      const newFailed = failedCount > this.lastFailedCount;
      this.scrolledList = list;
      this.lastTailId = tailId;
      this.lastFailedCount = failedCount;

      // Вниз прокручиваем, если: чат только что открылся; новое сообщение — моё (я его только что
      // отправил и хочу видеть) или моё не ушло; человек и так был внизу. Последнее касается и
      // снимков без новых сообщений (часики → галочка): высота пузыря могла чуть измениться.
      if (opened || (newTail && tail?.mine) || newFailed || this.nearBottom) {
        list.scrollTop = list.scrollHeight;
        this.nearBottom = true;
        this.newBelow.set(false);
      } else if (newTail && tail) {
        // Человек читает историю выше — не дёргаем его, а показываем плашку «Новые сообщения».
        this.newBelow.set(true);
      }
    });

    // Таймер «ухода» не должен сработать, когда страницы уже нет.
    inject(DestroyRef).onDestroy(() => clearTimeout(this.leavingTimer));
  }

  protected send(): void {
    const text = this.draft.value.trim();
    if (!text || this.draft.invalid || this.sending() || this.state() !== 'ready') {
      return;
    }
    // Поле очищаем сразу, не дожидаясь сервера: Firestore и так мгновенно покажет сообщение
    // в списке (из локального кэша) — с «часиками», пока сервер его не подтвердит.
    // sending снимается, как только сообщение появилось в списке (см. applyMessages) или запись
    // завершилась. Ждать только ответа сервера нельзя: без сети он не придёт никогда,
    // и человек не смог бы отправить второе сообщение офлайн.
    this.sending.set(true);
    this.draft.reset();
    // Фокус остаётся в поле ввода: на телефоне клавиатура не закрывается, можно писать дальше.
    this.input()?.nativeElement.focus();
    void this.deliver(this.matchId(), text);
  }

  // Отправка формы кнопкой: отменяем «родное» поведение браузера (перезагрузку страницы)
  // и отправляем сообщение сами.
  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.send();
  }

  // «Повторить» у неотправленного сообщения: убираем его из списка ошибок и пробуем ещё раз.
  // Если снова не выйдет — deliver опять положит его в конец списка ошибок.
  protected resend(message: FailedMessage): void {
    if (this.state() !== 'ready') {
      return;
    }
    this.failed.update((list) => list.filter((m) => m.id !== message.id));
    void this.deliver(this.matchId(), message.text);
  }

  // «Удалить» у неотправленного: человек передумал его отправлять.
  protected discard(message: FailedMessage): void {
    this.failed.update((list) => list.filter((m) => m.id !== message.id));
    // Кнопка, на которой был фокус, исчезла вместе с пузырём — возвращаем фокус в поле ввода,
    // иначе он «упадёт» на <body> и клавиатурный пользователь потеряет место.
    this.input()?.nativeElement.focus();
  }

  // Плашка «Новые сообщения ↓»: плавно едем вниз (или сразу, если человек просил меньше анимации).
  protected scrollToBottom(): void {
    const list = this.list()?.nativeElement;
    if (!list) {
      return;
    }
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo({ top: list.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
    this.newBelow.set(false);
    // Плашка-кнопка сейчас исчезнет — фокус переводим на сам список, чтобы он не потерялся.
    list.focus({ preventScroll: true });
  }

  // Каждая прокрутка списка: запоминаем, внизу ли человек. Доскроллил до низа сам — плашка не нужна.
  protected onScroll(): void {
    const list = this.list()?.nativeElement;
    if (!list) {
      return;
    }
    this.nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
    if (this.nearBottom && this.newBelow()) {
      this.newBelow.set(false);
    }
  }

  // Сама запись. Запоминаем, в какой чат отправляем: пока ждём сервер, человек может перейти
  // в другой чат, и тогда ответ (успех или ошибка) к открытому сейчас чату уже не относится.
  private async deliver(matchId: string, text: string): Promise<void> {
    try {
      await this.chat.send(matchId, this.me, text);
    } catch (error) {
      if (matchId !== this.matchId()) {
        return;
      }
      // Нет доступа или документа — ВОЗМОЖНО, мэтча уже нет. Но правила могут отказать и при живом
      // мэтче (например, текст не прошёл проверку) — поэтому спрашиваем сервер, есть ли мэтч.
      if (this.isMatchGone(error) && !(await this.matchStillExists(matchId))) {
        if (matchId === this.matchId()) {
          this.end();
          this.sending.set(false);
        }
        return;
      }
      if (matchId !== this.matchId()) {
        return;
      }
      // Сообщение не ушло: показываем его в конце переписки с пометкой «Не отправлено»
      // и кнопкой «Повторить» — текст не теряется, и видно, какое именно сообщение не дошло.
      const id = `failed-${++this.failedSeq}`;
      this.failed.update((list) => [...list, { id, text }]);
      // Глазами ошибку видно по пузырю, а программе чтения с экрана сообщаем через живую область.
      // Нет сети — просим проверить интернет; иначе — нейтральное «не получилось, попробуй ещё раз».
      const key = isNetworkErrorKey(firestoreErrorKey(error))
        ? 'chat.sendErrorNetwork'
        : 'chat.sendError';
      this.announcement.set([{ key: id, lines: [this.i18n.translate(key)] }]);
    }
    if (matchId === this.matchId()) {
      this.sending.set(false);
    }
  }

  // Кнопка отправки не забирает фокус у поля ввода: если фокус уйдёт на кнопку, на телефоне
  // спрячется клавиатура. preventDefault у pointerdown отменяет только «перевод фокуса»,
  // а click (и отправка формы) всё равно происходит.
  protected keepFocus(event: PointerEvent): void {
    event.preventDefault();
  }

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  // Мэтч разорван или собеседник заблокирован — чата больше нет, возвращаемся к списку мэтчей.
  protected leave(): void {
    void this.router.navigateByUrl('/matches');
  }

  // Я подтвердил разрыв/блокировку в меню «⋮», запрос ещё в пути. Мэтч вот-вот пропадёт —
  // это не «собеседник ушёл», поэтому плашку «Чат завершён» не показываем.
  // Дальше одно из трёх: removed (успех — уходим, см. leave), removeFailed (ошибка — см.
  // onRemoveFailed) или, на всякий случай, таймер: если за LEAVING_TIMEOUT_MS ни того ни другого
  // не случилось (например, запрос завис без сети), перестаём ждать и смотрим, что на сервере.
  protected onRemoving(): void {
    const matchId = this.matchId();
    this.leaving = true;
    clearTimeout(this.leavingTimer);
    this.leavingTimer = setTimeout(() => {
      if (matchId === this.matchId()) {
        this.finishLeaving(matchId, true);
      }
    }, LEAVING_TIMEOUT_MS);
  }

  // Разрыв/блокировка не удались (меню «⋮» уже показало ошибку). Чат не должен остаться
  // «замороженным»: снимаем флаг ухода и показываем всё, что пришло, пока мы ждали.
  protected onRemoveFailed(): void {
    this.finishLeaving(this.matchId(), false);
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

  // Ожидание «своего» ухода закончилось, а со страницы мы так и не ушли.
  // afterTimeout — сработал таймер: запрос мог просто затянуться и всё-таки удалить мэтч.
  private finishLeaving(matchId: string, afterTimeout: boolean): void {
    if (!this.leaving) {
      return;
    }
    const suppressed = this.endSuppressed;
    this.stopLeaving();
    if (suppressed) {
      // Пока «уходили», мы игнорировали признаки завершения. Проверяем их на сервере.
      // Если мэтча действительно нет, а ждали мы своего же медленного разрыва, — плашка
      // «Чат завершён» была бы странной: человек сам этого хотел. Просто уходим к мэтчам.
      if (afterTimeout) {
        void this.matchStillExists(matchId).then((exists) => {
          if (matchId !== this.matchId()) {
            return;
          }
          if (exists) {
            this.applyPending();
          } else {
            this.leave();
          }
        });
      } else {
        this.verifyEnded(matchId);
      }
      return;
    }
    // Признаков завершения не было — просто применяем отложенный снимок переписки (если есть).
    this.applyPending();
  }

  private applyPending(): void {
    const pending = this.pendingMessages;
    this.pendingMessages = null;
    if (pending && this.state() === 'ready' && !this.verifying) {
      this.applyMessages(pending, false);
    }
  }

  private stopLeaving(): void {
    clearTimeout(this.leavingTimer);
    this.leaving = false;
    this.endSuppressed = false;
  }

  // Новый снимок переписки. Здесь три задачи: не трогать «замороженный» завершённый чат;
  // заметить, что сообщения начали исчезать (их стирают перед удалением мэтча);
  // и подготовить озвучку для новых входящих.
  private onMessages(matchId: string, messages: ChatMessage[], fromCache: boolean): void {
    if (matchId !== this.matchId() || this.state() === 'ended') {
      return;
    }
    // По одному сообщения в этом приложении никто не удаляет — их стирают только вместе с мэтчем
    // (разрыв или блокировка). Поэтому «сообщений стало меньше» — повод заподозрить конец чата,
    // но не доказательство (снимок мог прийти из неполного кэша). Пока сервер не ответил,
    // переписку «замораживаем», а последний снимок откладываем, чтобы применить, если мэтч жив.
    // Считаем только подтверждённые сервером: если сервер отклонил МОЁ неотправленное сообщение,
    // Firestore убирает его из списка — это не признак конца чата (см. FailedMessage).
    const confirmed = (list: ChatMessage[]) => list.filter((m) => !m.pending).length;
    const shrunk = confirmed(messages) < confirmed(this.messages());
    // Пока я сам разрываю мэтч, переписку замораживаем, только когда она начала исчезать:
    // обычные снимки (новое входящее, «часики» → галочка) показываем как всегда — иначе
    // при неудачном разрыве чат выглядел бы зависшим.
    if (
      this.state() === 'ready' &&
      (this.verifying || shrunk || (this.leaving && this.endSuppressed))
    ) {
      this.pendingMessages = messages;
      if (this.leaving) {
        // Сам ухожу — сообщения стираются из-за моего же разрыва. Просто не показываем это.
        // Если уход сорвётся, отложенный снимок применит finishLeaving.
        this.endSuppressed = true;
        return;
      }
      this.verifyEnded(matchId);
      return;
    }
    this.applyMessages(messages, fromCache);
  }

  private applyMessages(messages: ChatMessage[], fromCache: boolean): void {
    this.messages.set(messages);
    this.sending.set(false);

    const seen = this.seenIds;
    if (!seen) {
      // Первый пустой снимок из кэша — это «кэш ещё пуст», а не «переписки нет». Точку отсчёта
      // ставим по следующему снимку — иначе вся пришедшая с сервера история была бы «новой»
      // и программа чтения с экрана зачитала бы её целиком.
      if (fromCache && messages.length === 0) {
        return;
      }
    } else {
      // Озвучиваем ВСЕ новые входящие из снимка (их может прийти несколько сразу, например
      // после восстановления сети), а не только последнее.
      const fresh = messages.filter(
        (m) =>
          m.from !== this.me &&
          !seen.has(m.id) &&
          (!m.createdAt || m.createdAt.getTime() >= this.seenUntil),
      );
      if (fresh.length) {
        const speaker = this.i18n.translate('chat.speaker.partner', { name: this.partnerName() });
        this.announcement.set([
          { key: fresh.at(-1)!.id, lines: fresh.map((m) => `${speaker} ${m.text}`) },
        ]);
      }
    }
    this.seenIds = new Set(messages.map((m) => m.id));
    // Берём только ВХОДЯЩИЕ: их время ставит сервер, а у моих неотправленных — примерное время
    // по часам телефона, которые могут спешить (и тогда «новое» входящее казалось бы старым).
    for (const m of messages) {
      if (m.from !== this.me && m.createdAt) {
        this.seenUntil = Math.max(this.seenUntil, m.createdAt.getTime());
      }
    }
  }

  // Подозрение, что чат завершён (сообщения исчезли, ошибка доступа). Спрашиваем сервер:
  // мэтча нет — завершаем; есть — это была ложная тревога, применяем отложенный снимок переписки.
  private verifyEnded(matchId: string): void {
    if (this.verifying) {
      return;
    }
    this.verifying = true;
    void this.matchStillExists(matchId).then((exists) => {
      if (matchId !== this.matchId()) {
        return;
      }
      this.verifying = false;
      const pending = this.pendingMessages;
      this.pendingMessages = null;
      if (!exists) {
        this.end();
      } else if (pending && this.state() === 'ready') {
        this.applyMessages(pending, false);
      }
    });
  }

  // Есть ли мэтч на сервере. Если проверить не удалось (нет сети) — считаем, что есть:
  // ошибочно «завершить» живой чат хуже, чем показать на минуту устаревшую переписку.
  // Настоящее удаление всё равно придёт через подписку watchMatch, когда появится сеть.
  private async matchStillExists(matchId: string): Promise<boolean> {
    try {
      return await this.chat.matchExists(matchId);
    } catch (error) {
      console.error(error);
      return true;
    }
  }

  // Чат завершён посреди разговора. Срабатывает только для уже открытого чата: если мэтча нет
  // с самого начала, это решает loadPartner (состояние notFound).
  // Если я сам сейчас разрываю мэтч — молчим: через мгновение уйдём на /matches.
  private end(): void {
    if (this.leaving) {
      this.endSuppressed = true;
      return;
    }
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
      this.fail(matchId, error);
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
  // Если чат уже был открыт, ошибка доступа — повод проверить, не удалили ли мэтч.
  private fail(matchId: string, error: unknown): void {
    // Ответ от прошлого чата или от «замороженного» завершённого — уже не важен.
    if (matchId !== this.matchId() || this.state() === 'ended') {
      return;
    }
    if (this.state() === 'ready' && isPermissionDenied(error)) {
      if (this.leaving) {
        this.endSuppressed = true;
        return;
      }
      // Подписка после ошибки уже не работает. Мэтча нет — чат завершён; есть — честно
      // показываем ошибку с кнопкой «Попробовать ещё раз», а не «Чат завершён».
      void this.matchStillExists(matchId).then((exists) => {
        if (matchId !== this.matchId() || this.state() !== 'ready') {
          return;
        }
        if (exists) {
          this.errorKey.set(firestoreErrorKey(error));
          this.state.set('error');
        } else {
          this.end();
        }
      });
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
