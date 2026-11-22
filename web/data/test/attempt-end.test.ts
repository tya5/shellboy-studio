import { expect, it } from 'vitest';
import { Handoff } from '../src/handoff';

it('keeps an adopted attempt through resync and removes only the fenced attempt', () => {
  const handoff = new Handoff(fn => fn(), () => 0);
  const text = (id: string) => handoff.apply({ attempt_id: id, input_through_node_id: 'p', gap: false, deltas: [{ offset: 0, reasoning: false, text: id }] });
  text('saved'); text('fenced'); text('next');
  handoff.end('saved', 'adopted');
  handoff.end('fenced', 'not_adopted');
  text('fenced');
  expect(handoff.records.peek().map(r => r.attemptId)).toEqual(['saved', 'next']);
  handoff.discard('resync');
  expect(handoff.records.peek().map(r => [r.attemptId, r.status])).toEqual([['saved', 'ended'], ['next', 'ended']]);
  handoff.releaseAccepted('saved');
  expect(handoff.records.peek().map(r => r.attemptId)).toEqual(['next']);
});
