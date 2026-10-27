import { DOCUMENT, Injectable, inject } from '@angular/core';
import { DISCORD_CLIENT_ID } from './connect.config';
import { ContactField } from './profile.model';

// Как работает «Подключить»:
// 1. start() запоминает случайный state и уводит браузер на сайт платформы (Steam / Discord).
// 2. Человек входит там и разрешает доступ.
// 3. Платформа возвращает его на /profile и дописывает в адрес, кто он такой.
// 4. finish() достаёт из адреса id профиля и превращает его в ссылку.
//
// state — защита от подделки: ответ принимаем, только если он пришёл на НАШ запрос из этой вкладки.
// Честно: без своего сервера проверка не железная — Steam-ответ стоило бы перепроверить на сервере
// (openid check_authentication). Для учебного проекта хватает, на настоящем сайте это делала бы Cloud Function.

const STATE_KEY = 'di-connect-state';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';

export interface ConnectResult {
  field: ContactField;
  link: string;
}

// Адрес входа через Steam (OpenID 2.0). Ключи не нужны — Steam пускает любой сайт.
export function steamLoginUrl(returnTo: string, realm: string): string {
  const params = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': `${OPENID_NS}/identifier_select`,
    'openid.claimed_id': `${OPENID_NS}/identifier_select`,
  });
  return `https://steamcommunity.com/openid/login?${params}`;
}

// Steam возвращает claimed_id вида https://steamcommunity.com/openid/id/76561198000000000 (17 цифр).
// null — человек нажал «Отмена» или ответ странный.
export function steamProfileLink(query: URLSearchParams): string | null {
  const match = query
    .get('openid.claimed_id')
    ?.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
  return query.get('openid.mode') === 'id_res' && match
    ? `https://steamcommunity.com/profiles/${match[1]}`
    : null;
}

// Адрес входа через Discord (OAuth2, implicit grant): токен придёт прямо в адрес после #.
// scope=identify — просим только id и ник, без доступа к серверам и сообщениям.
export function discordLoginUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: 'identify',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

@Injectable({ providedIn: 'root' })
export class PlatformConnect {
  private readonly document = inject(DOCUMENT);

  canConnect(field: ContactField): boolean {
    return field === 'steam' || (field === 'discord' && DISCORD_CLIENT_ID !== '');
  }

  start(field: ContactField): void {
    const location = this.document.location;
    const state = crypto.randomUUID();
    sessionStorage.setItem(STATE_KEY, `${field}:${state}`);

    const back = `${location.origin}/profile`;
    location.assign(
      field === 'steam'
        ? steamLoginUrl(`${back}?connect=steam&state=${state}`, location.origin)
        : discordLoginUrl(DISCORD_CLIENT_ID, back, state),
    );
  }

  // Вызывается при открытии профиля. null — мы не возвращались с платформы или человек отменил вход.
  async finish(): Promise<ConnectResult | null> {
    const location = this.document.location;
    const query = new URLSearchParams(location.search);
    const fragment = new URLSearchParams(location.hash.slice(1));
    const state = query.get('state') ?? fragment.get('state');
    const saved = sessionStorage.getItem(STATE_KEY);
    if (!state || !saved) {
      return null;
    }

    // Ответ одноразовый: сразу забываем state и убираем из адреса токен и параметры Steam.
    sessionStorage.removeItem(STATE_KEY);
    this.document.defaultView?.history.replaceState(null, '', location.pathname);

    const [field, expectedState] = saved.split(':');
    if (state !== expectedState) {
      throw new Error('Connect state mismatch');
    }

    if (field === 'steam') {
      const link = steamProfileLink(query);
      return link ? { field, link } : null;
    }

    if (field === 'discord') {
      const token = fragment.get('access_token');
      if (!token) {
        return null; // человек нажал «Отмена» в Discord
      }
      const response = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`Discord answered ${response.status}`);
      }
      const { id } = (await response.json()) as { id: string };
      return { field, link: `https://discord.com/users/${id}` };
    }

    return null;
  }
}
