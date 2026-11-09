import './auth-mode.css';
let generation = 0;
/** The public endpoint exposes one configuration bit, never credentials or owner data. */
export async function showAuthMode(): Promise<void> {
  const current = ++generation;
  try {
    const response = await fetch('/auth-mode', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    const mode: unknown = await response.json();
    if (current !== generation) return;
    if (typeof mode === 'object' && mode !== null && 'authentication_required' in mode && mode.authentication_required === true) {
      document.querySelector('.studio-no-auth')?.remove();
      document.body.classList.remove('studio-no-auth-mode');
      return;
    }
    if (typeof mode !== 'object' || mode === null || !('authentication_required' in mode) || mode.authentication_required !== false) return;
    if (document.querySelector('.studio-no-auth')) return;
    const warning = document.createElement('div');
    warning.className = 'studio-no-auth';
    warning.setAttribute('role', 'status');
    warning.textContent = navigator.language.startsWith('ja') ? '認証なし' : 'Authentication off';
    warning.title = navigator.language.startsWith('ja')
      ? '到達できる全員が操作できます。インターネット公開は禁止です（Tailscale Funnel など）。VPN はユーザー認証の代わりにはなりません。'
      : 'Anyone who can reach this bridge can operate it. Never expose it publicly (for example via Tailscale Funnel). A VPN is not user authentication.';
    document.body.classList.add('studio-no-auth-mode');
    document.body.prepend(warning);
  } catch { /* Unknown mode is not claimed to be authenticated or unauthenticated. */ }
}
