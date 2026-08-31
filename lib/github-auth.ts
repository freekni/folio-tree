export type GitHubSession = {
  token: string;
  login: string;
  expiresAt?: number;
};

type AuthMessage = {
  type?: string;
  token?: string;
  login?: string;
  expiresIn?: number;
  error?: string;
};

const authBaseUrl = (import.meta.env.VITE_GITHUB_AUTH_BASE_URL as string | undefined)?.replace(/\/$/, '');
export const githubAppInstallUrl = import.meta.env.VITE_GITHUB_APP_INSTALL_URL as string | undefined;

export function githubAuthConfigured() {
  return Boolean(authBaseUrl && githubAppInstallUrl);
}

export function authorizeGitHub(): Promise<GitHubSession> {
  if (!authBaseUrl) return Promise.reject(new Error('GitHub 인증 서버가 아직 설정되지 않았습니다.'));

  const expectedOrigin = new URL(authBaseUrl).origin;
  const authorizationUrl = `${authBaseUrl}/oauth/start?origin=${encodeURIComponent(window.location.origin)}`;
  const popup = window.open(authorizationUrl, 'folio-github-auth', 'popup=yes,width=560,height=720');
  if (!popup) return Promise.reject(new Error('GitHub 로그인 팝업이 차단되었습니다. 팝업을 허용한 후 다시 시도해주세요.'));

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', receiveMessage);
      window.clearInterval(closedTimer);
      window.clearTimeout(timeoutTimer);
      callback();
    };
    const receiveMessage = (event: MessageEvent<AuthMessage>) => {
      if (event.origin !== expectedOrigin || event.data?.type !== 'folio-github-auth') return;
      if (event.data.error || !event.data.token) {
        finish(() => reject(new Error(event.data.error || 'GitHub 인증 결과를 확인할 수 없습니다.')));
        return;
      }
      finish(() => resolve({
        token: event.data.token!,
        login: event.data.login || 'GitHub 사용자',
        expiresAt: event.data.expiresIn ? Date.now() + event.data.expiresIn * 1000 : undefined,
      }));
    };
    const closedTimer = window.setInterval(() => {
      if (popup.closed) finish(() => reject(new Error('GitHub 인증 창이 닫혔습니다.')));
    }, 500);
    const timeoutTimer = window.setTimeout(() => {
      popup.close();
      finish(() => reject(new Error('GitHub 인증 시간이 만료되었습니다. 다시 시도해주세요.')));
    }, 5 * 60 * 1000);
    window.addEventListener('message', receiveMessage);
  });
}

export function sessionIsValid(session: GitHubSession | null) {
  return Boolean(session && (!session.expiresAt || session.expiresAt > Date.now() + 30_000));
}
