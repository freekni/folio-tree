type Env = {
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_APP_CLIENT_SECRET: string;
  ALLOWED_ORIGINS: string;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

function allowedOrigins(env: Env) {
  return new Set(env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean));
}

function noStoreHeaders(extra: HeadersInit = {}) {
  return { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra };
}

function errorResponse(message: string, status = 400) {
  return new Response(message, { status, headers: noStoreHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }) });
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function parseCookies(request: Request) {
  return Object.fromEntries((request.headers.get('Cookie') || '').split(';').map((part) => {
    const [key, ...value] = part.trim().split('=');
    return [key, decodeURIComponent(value.join('='))];
  }).filter(([key]) => key));
}

function callbackHtml(targetOrigin: string, payload: Record<string, unknown>) {
  const serializedOrigin = JSON.stringify(targetOrigin).replace(/</g, '\\u003c');
  const serializedPayload = JSON.stringify({ type: 'folio-github-auth', ...payload }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Folio Tree GitHub 인증</title></head><body><p>GitHub 인증을 완료했습니다. 이 창은 자동으로 닫힙니다.</p><script>if(window.opener){window.opener.postMessage(${serializedPayload},${serializedOrigin});}window.close();</script></body></html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET') return errorResponse('Method not allowed', 405);

    if (url.pathname === '/health') {
      return new Response('ok', { headers: noStoreHeaders({ 'Content-Type': 'text/plain' }) });
    }

    if (url.pathname === '/oauth/start') {
      const origin = (url.searchParams.get('origin') || '').replace(/\/$/, '');
      if (!allowedOrigins(env).has(origin)) return errorResponse('허용되지 않은 Folio Tree 주소입니다.', 403);
      if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET) return errorResponse('GitHub App 인증 설정이 완료되지 않았습니다.', 503);

      const state = randomState();
      const authorize = new URL('https://github.com/login/oauth/authorize');
      authorize.searchParams.set('client_id', env.GITHUB_APP_CLIENT_ID);
      authorize.searchParams.set('redirect_uri', `${url.origin}/oauth/callback`);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('prompt', 'select_account');
      const cookie = `folio_oauth=${encodeURIComponent(`${state}.${origin}`)}; Path=/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
      return new Response(null, { status: 302, headers: { Location: authorize.toString(), 'Set-Cookie': cookie } });
    }

    if (url.pathname === '/oauth/callback') {
      const stored = parseCookies(request).folio_oauth || '';
      const separator = stored.indexOf('.');
      const storedState = separator >= 0 ? stored.slice(0, separator) : '';
      const targetOrigin = separator >= 0 ? stored.slice(separator + 1) : '';
      const state = url.searchParams.get('state') || '';
      const code = url.searchParams.get('code') || '';
      if (!state || !code || state !== storedState || !allowedOrigins(env).has(targetOrigin)) {
        return errorResponse('GitHub 인증 요청을 확인할 수 없습니다. Folio Tree에서 다시 시도해주세요.', 400);
      }

      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.GITHUB_APP_CLIENT_ID,
          client_secret: env.GITHUB_APP_CLIENT_SECRET,
          code,
          redirect_uri: `${url.origin}/oauth/callback`,
        }),
      });
      const token = await tokenResponse.json<TokenResponse>();
      if (!tokenResponse.ok || !token.access_token) {
        const html = callbackHtml(targetOrigin, { error: token.error_description || token.error || 'GitHub 인증에 실패했습니다.' });
        return new Response(html, { status: 200, headers: noStoreHeaders({ 'Content-Type': 'text/html; charset=utf-8' }) });
      }

      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token.access_token}`,
          'User-Agent': 'Folio-Tree-GitHub-App',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      const user = userResponse.ok ? await userResponse.json<{ login?: string }>() : {};
      const html = callbackHtml(targetOrigin, {
        token: token.access_token,
        login: user.login,
        expiresIn: token.expires_in,
      });
      return new Response(html, {
        headers: noStoreHeaders({
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
          'Set-Cookie': 'folio_oauth=; Path=/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        }),
      });
    }

    return errorResponse('Not found', 404);
  },
} satisfies ExportedHandler<Env>;
