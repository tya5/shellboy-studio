export async function fixtureOrigin(port, kind) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 8751) {
    throw new Error('Expected a non-default loopback fixture port');
  }
  const origin = `http://127.0.0.1:${port}`;
  const response = await fetch(`${origin}/__studio_test_fixture`, { redirect: 'error', signal: AbortSignal.timeout(2000) });
  if (!response.ok || await response.text() !== kind) throw new Error(`Expected the ${kind} synthetic fixture server`);
  return origin;
}
