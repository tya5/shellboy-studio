// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showAuthMode } from './auth-mode';
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; document.body.className = ''; });
describe('explicit no-auth bootstrap indicator', () => {
  it('shows a persistent strip outside the swappable design only on explicit false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authentication_required: false }) }));
    document.body.innerHTML = '<main id="root"></main>';
    await showAuthMode();
    const strip = document.querySelector('.studio-no-auth')!;
    expect(strip.textContent).toContain('Authentication off');
    expect(strip.parentElement).toBe(document.body);
    document.getElementById('root')!.replaceChildren();
    expect(strip.isConnected).toBe(true);
    expect(document.body.classList.contains('studio-no-auth-mode')).toBe(true);
  });
  it.each([{}, { authentication_required: true }, { authentication_required: null }])('never guesses unauthenticated from %o', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
    await showAuthMode(); expect(document.querySelector('.studio-no-auth')).toBeNull();
  });
  it('does not leak errors or credentials on unavailable bootstrap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('synthetic')));
    await showAuthMode(); expect(document.body.textContent).toBe('');
  });
});

it('does not duplicate the indicator and removes it only on explicit authenticated mode', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authentication_required: false }) });
  vi.stubGlobal('fetch', fetcher);
  await showAuthMode(); await showAuthMode();
  expect(document.querySelectorAll('.studio-no-auth')).toHaveLength(1);
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ authentication_required: true }) });
  await showAuthMode(); expect(document.querySelector('.studio-no-auth')).toBeNull();
});
