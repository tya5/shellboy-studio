export interface PairingLink { url: string; expires_in_seconds: number }
export async function pairingHosts(): Promise<string[]> {
  const response = await fetch('/pairing', { cache: 'no-store' });
  if (!response.ok) throw new Error('Unable to load hosts');
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('hosts' in body) || !Array.isArray(body.hosts)) throw new Error('Invalid host list');
  return body.hosts.filter((host): host is string => typeof host === 'string');
}
export async function issuePairing(host: string): Promise<PairingLink> {
  const response = await fetch('/pairing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host }), cache: 'no-store' });
  if (!response.ok) throw new Error('Unable to issue a pairing link');
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('url' in body) || typeof body.url !== 'string' || !('expires_in_seconds' in body) || typeof body.expires_in_seconds !== 'number') throw new Error('Invalid pairing response');
  return { url: body.url, expires_in_seconds: body.expires_in_seconds };
}
