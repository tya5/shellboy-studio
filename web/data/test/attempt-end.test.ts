import { expect, it } from 'vitest';
import { Handoff } from '../src/handoff';

it('stages the held replay and keeps the prior cut until history commits', () => {
  const handoff = new Handoff(fn => fn(), () => 0);
  const text = (id: string) => handoff.apply({ attempt_id: id, input_through_node_id: 'p', gap: false, deltas: [{ offset: 0, reasoning: false, text: id }] });
  text('saved'); text('fenced'); text('next');
  handoff.end('saved', 'adopted');
  handoff.end('fenced', 'not_adopted');
  text('fenced');
  expect(handoff.records.peek().map(r => r.attemptId)).toEqual(['saved', 'next']);
  handoff.discard('resync');
  expect(handoff.records.peek().map(r => [r.attemptId, r.status])).toEqual([['saved', 'ended'], ['next', 'streaming']]);
  text('next');
  expect(handoff.captureReplacement()?.map(r => r.attemptId)).toEqual(['next']);
  expect(handoff.records.peek().map(r => r.attemptId)).toEqual(['saved', 'next']);
  handoff.commitReplacement();
  expect(handoff.records.peek().map(r => r.attemptId)).toEqual(['next']);
});

it('retains output-limit evidence only on the matching ended attempt', () => {
  const handoff = new Handoff(fn => fn(), () => 0);
  const text = (id: string) => handoff.apply({ attempt_id: id, gap: false, deltas: [{ offset: 0, reasoning: false, text: id }] });
  text('limited'); text('ordinary');
  const fact = { stop: true, sent_max_tokens: 1234, source: 'connection' as const, connection: 'mock' };
  handoff.end('limited', 'adopted', fact);
  handoff.end('ordinary', 'adopted');
  expect(handoff.records.peek().map(record => [record.attemptId, record.outputLimit])).toEqual([['limited', fact], ['ordinary', undefined]]);
});
