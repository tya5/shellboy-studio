import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import assert from 'node:assert/strict';

// Provenance only: this does not define, repair or validate a Core wire schema.
export async function readVerifiedProducerFixture({directory, producerSha, windowSha256, schemaSha256, command}) {
  assert.match(producerSha, /^[0-9a-f]{40}$/);
  assert(command.includes('history_window_items::actual_window_opt_in_and_encoding_fixture'));
  const read = async (name, expected) => {
    assert.match(expected, /^[0-9a-f]{64}$/);
    const bytes = await readFile(join(directory, name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `${name} provenance mismatch`);
    return JSON.parse(bytes.toString('utf8'));
  };
  const encoded = await read('actual-window.json', windowSha256);
  const schema = await read('schema.json', schemaSha256);
  return Object.freeze({producerSha, command, encoded, schema});
}

// The result is replayed unchanged. Strict decoding remains O's real production code.
export function deliverProducerWindow(transport, call, fixture) {
  assert.equal(call.command, 'history.window');
  transport.ok(call.id, fixture.encoded);
}
