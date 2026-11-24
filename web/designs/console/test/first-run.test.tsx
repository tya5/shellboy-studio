// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { expect, it } from 'vitest';
import { fixtureModel, settle } from '../../../ui-core/test/fixture';
import { loadPrefs } from '../../../ui-core/src/prefs';
import { Setup } from '../screens/Setup';
import { Conversation } from '../screens/Conversation';

async function mounted(f: Awaited<ReturnType<typeof fixtureModel>>, view: 'setup' | 'conversation', test: (host: HTMLElement, step: (work: () => void) => Promise<void>) => Promise<void>) {
  const host = document.createElement('div');
  document.body.append(host);
  const context = { model: f.model, prefs: signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: 'console', themes: [{ name: 'light' }] }])), designs: [], setPrefs: () => {}, submitToken: async () => false };
  const step = async (work: () => void) => { await act(async () => { work(); await settle(f.t, f.db); }); };
  try {
    await step(() => render(view === 'setup' ? <Setup context={context} /> : <Conversation model={f.model} />, host));
    await test(host, step);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
}

const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;
function input(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

it.each([404, 405, 200, 401, 204])('catalog HTTP %s only permits manual model save when the route is absent', async status => {
  const keepDefault = status === 204;
  const f = await fixtureModel({ route: 'setup', capabilities: ['connection.setup'], configure(db) {
    const other = db.answer.bind(db);
    db.answer = call => {
      switch (call.command) {
        case 'config.get': return { ok: true, result: { file: { present: keepDefault, valid: true, content_hash: 'fresh', values: keepDefault ? { default_connection: 'other', default_model: 'existing' } : {} } } };
        case 'connection.test': return { ok: true, result: { ok: status === 200 || keepDefault, http_status: status, models: [], ...(status === 200 || keepDefault ? {} : { failure: status === 404 ? 'url' : status === 405 ? 'other' : 'auth' }) } };
        case 'config.set': return { ok: true, result: { written: true, content_hash: 'saved', changes: [], restart_required: true } };
        case 'credentials.set': return { ok: true, result: { connection: 'litellm', stored: true, replaced: false, key_source: 'stored', credentials_path: '/fixture/credentials.toml', permissions_tightened: false, changed_by: null } };
        default: return other(call);
      }
    };
  } });
  await mounted(f, 'setup', async (host, step) => {
    await step(() => { [...host.querySelectorAll('button, label')].find(el => el.textContent?.includes('LiteLLM proxy'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const address = host.querySelector<HTMLInputElement>('input[placeholder="https://"]')!;
    await step(() => { input(address, 'https://proxy.example.test/v1'); input(host.querySelector('input[type="password"]')!, 'fixture-key'); });
    await step(() => button(host, 'Test connection').click());
    const model = host.querySelector<HTMLInputElement>('input[aria-label="Or type a model ID"]');
    if (status === 401) {
      expect(model).toBeNull();
      expect(f.t.calls('config.set')).toHaveLength(0);
      return;
    }
    expect(host.textContent).toContain('not verified for conversations');
    if (keepDefault) {
      const toggle = host.querySelector<HTMLInputElement>('input[type=checkbox]')!;
      await step(() => toggle.click());
      await step(() => toggle.click());
      expect(host.querySelector('input[aria-label="Or type a model ID"]')).toBeNull();
      const save = button(host, 'Save and use this connection');
      await step(() => save.click());
      expect(f.t.calls('config.set')).toHaveLength(1);
      expect(f.t.calls('config.set')[0]?.args).not.toMatchObject({ changes: expect.arrayContaining([{ field: 'default_model' }]) });
      return;
    }
    expect(button(host, 'Save and use this connection').disabled).toBe(true);
    await step(() => input(model!, 'company/chat'));
    await step(() => button(host, 'Save and use this connection').click());
    expect(f.t.calls('config.set')[0]?.args).toMatchObject({ changes: expect.arrayContaining([{ field: 'default_model', value: 'company/chat' }]) });
    expect(f.t.calls('credentials.set')).toHaveLength(1);
    expect(button(host, 'Restart owner')).toBeUndefined();
    await step(() => f.t.push({ t: 'launcher_managed', instance_id: 'i1' }));
    await step(() => button(host, 'Restart owner').click());
    expect(f.t.sent).toContainEqual({ t: 'launcher', action: 'restart', instance_id: 'i1' });
  });
});

it('links to configuration help and re-reads a repaired file without writing it', async () => {
  let valid = false;
  const f = await fixtureModel({ route: 'setup', capabilities: ['connection.setup'], configure(db) {
    const other = db.answer.bind(db);
    db.answer = call => call.command === 'config.get' ? { ok: true, result: { config_path: '/fixture/config.toml', file: { present: true, valid, content_hash: 'fresh', error: 'bad TOML', values: {} } } } : other(call);
  } });
  await mounted(f, 'setup', async (host, step) => {
    expect(host.textContent).toContain('/fixture/config.toml');
    expect(host.textContent).toContain('Nothing was changed');
    expect(host.querySelector('a[href*="first-setup-without-an-owner"]')).not.toBeNull();
    valid = true;
    await step(() => button(host, 'Retry').click());
    expect(host.textContent).toContain('LiteLLM proxy');
    expect(f.t.calls('config.set')).toHaveLength(0);
  });
});

it('offers connection setup from a rejected send without sending again', async () => {
  const f = await fixtureModel({ route: 'conversation', threadId: 'lead', configure(db) {
    const other = db.answer.bind(db);
    db.answer = call => call.command === 'message.send' ? { ok: false, code: 'config_invalid', message: 'No model configured' } : other(call);
  } });
  await mounted(f, 'conversation', async (host, step) => {
    await step(() => { void f.model.send('Hello'); });
    expect(host.querySelector('a[href="#/setup"]')?.textContent).toBe('Open connection setup');
    expect(host.querySelector('a[href*="first-setup-without-an-owner"]')).not.toBeNull();
    expect(f.t.calls('message.send')).toHaveLength(1);
  });
});
