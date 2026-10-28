// Сколько ждём ответа сервера при сохранении, прежде чем сказать «нет связи».
export const SAVE_TIMEOUT_MS = 10_000;

// Своя ошибка «сеть не ответила». Это НЕ «запись пропала»: Firestore положил её в очередь
// на этом устройстве и сам отправит, когда связь вернётся. Поэтому ошибка несёт с собой
// pending — тот же Promise записи: по нему страница узнает, когда запись всё-таки дошла
// (или сервер её отклонил), и скажет об этом человеку.
export class NetworkTimeoutError extends Error {
  constructor(readonly pending: Promise<unknown>) {
    super('Network timeout');
    this.name = 'NetworkTimeoutError';
  }
}

// Зачем это нужно: без сети Firestore НЕ падает с ошибкой — он ставит запись в очередь
// и ждёт, когда связь вернётся. Promise записи при этом висит сколько угодно, а кнопка — «Сохранение…».
// Поэтому «гонка» (как Promise.race): кто первый — ответ сервера, таймер на timeoutMs
// или событие браузера offline. Если браузер уже знает, что сети нет (navigator.onLine === false), сдаёмся сразу.
// Важно: сама запись из очереди Firestore никуда не девается и дойдёт позже, когда сеть вернётся
// (пока открыта вкладка), — поэтому страница говорит «сохранено на устройстве», а не «не сохранилось».
export function withNetworkTimeout<T>(
  work: Promise<T>,
  win: Window,
  timeoutMs = SAVE_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // Уборка: снимаем таймер и слушатель, кто бы ни победил, — иначе они жили бы до перезагрузки.
    const cleanup = () => {
      clearTimeout(timer);
      win.removeEventListener('offline', giveUp);
    };
    const giveUp = () => {
      cleanup();
      reject(new NetworkTimeoutError(work));
    };
    const timer = setTimeout(giveUp, timeoutMs);
    win.addEventListener('offline', giveUp);
    if (!win.navigator.onLine) {
      giveUp();
    }
    // Повторный resolve/reject у Promise ничего не делает, так что опоздавший ответ безопасен.
    work.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
