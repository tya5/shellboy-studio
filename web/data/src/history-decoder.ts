import {sanitizeMessageRelation,validHistoryProvenance} from "./message-provenance";
import type {HistoryItem,HistoryWindowResult} from "./protocol";

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
type Decoded<T> = { ok: true; value: T } | { ok: false; reason: string };
// Core942 protocol1611-1616 / spill_tools.rs: bounded public metadata only.
function validSpillTools(value: unknown): boolean {
  if (value === null) return true;
  if (!isObject(value) || typeof value.status !== 'string' || typeof value.truncated !== 'boolean' || !Array.isArray(value.items) || value.items.length > 8) return false;
  const encoder = new TextEncoder();
  const optionalId = (id: unknown) => id === undefined || id === null || (typeof id === 'string' && encoder.encode(id).length <= 256);
  if (!value.items.every(item => isObject(item) && typeof item.call_id === 'string' && item.call_id.length > 0 && encoder.encode(item.call_id).length <= 256 && optionalId(item.execution_id) && optionalId(item.original_node_id))) return false;
  // Duplicate/conflicting public tuples are valid wire facts, not authority to merge tools.
  return encoder.encode(JSON.stringify(value)).length <= 16384;
}
const historyItemReasons = new Set(['source_budget', 'response_budget', 'legacy', 'pruned', 'opaque', 'unsupported']);
function validToolDescriptor(value: unknown, result: boolean): value is Record<string, unknown> {
  if (!isObject(value) || Object.keys(value).some(key => !['call_id', 'call_id_state', 'name', 'name_state'].includes(key))) return false;
  const states: readonly unknown[] = ['available', 'missing', 'invalid', 'field_budget', 'not_applicable'];
  if (!states.includes(value.call_id_state) || !states.includes(value.name_state) || value.call_id_state === 'not_applicable') return false;
  if (result ? value.name_state !== 'not_applicable' : value.name_state === 'not_applicable') return false;
  for (const [key, state] of [['call_id', value.call_id_state], ['name', value.name_state]] as const) {
    const field = value[key];
    if (state === 'available') {
      if (typeof field !== 'string' || !field || new TextEncoder().encode(field).length > 256) return false;
      if (key === 'name' && /[^\x21-\x7e]/.test(field)) return false;
    } else if (Object.hasOwn(value, key)) return false;
  }
  return true;
}
export const decodeHistoryWindow: (v: unknown) => Decoded<HistoryWindowResult> = (v) => {
  const bad = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
  if (!isObject(v) || !Array.isArray(v.items) || v.items.length > 200 || !Number.isSafeInteger(v.total) || (v.total as number) < 0 || !(typeof v.revision === 'string' || typeof v.revision === 'number')) return bad('invalid history.window envelope');
  if (v.items.some(node => isObject(node) && (
    ["excerpt_omitted", "excerpt_truncated", "execution_count_exact"].some(key => Object.hasOwn(node, key) && typeof node[key] !== "boolean")
    || (Object.hasOwn(node, "execution_count") && (!Number.isSafeInteger(node.execution_count) || (node.execution_count as number) < 0))
    || (Object.hasOwn(node, "execution_count_exact") && !Object.hasOwn(node, "execution_count"))
  ))) return bad('invalid history snippet coverage');
  if (v.items.some(node => isObject(node) && !validHistoryProvenance(node.provenance,node.kind))) return bad('invalid history provenance identity');
  if (v.items.some(node => isObject(node) && Object.hasOwn(node, 'spill_tools') && !validSpillTools(node.spill_tools))) return bad('invalid public spill identities');
  if (!v.items.some(node => isObject(node) && (Object.hasOwn(node, 'items') || Object.hasOwn(node, 'items_unavailable_reason')))) return { ok: true, value: {...v,items:(v.items as unknown as HistoryItem[]).map(sanitizeMessageRelation)} as unknown as HistoryWindowResult };
  let bytes = 0; let deferred = false; let previous = -1;
  const encoder = new TextEncoder();
  for (const node of v.items) {
    if (!isObject(node) || !isObject(node.selection) || !Number.isSafeInteger(node.selection.ordinal) || (node.selection.ordinal as number) < 0 || (node.selection.ordinal as number) <= previous) return bad('invalid history node ordinal');
    previous = node.selection.ordinal as number;
    if (!Object.hasOwn(node, 'items')) {
      if (Object.hasOwn(node, 'items_unavailable_reason') || deferred) return bad('missing deferred projection');
      continue; // Honest legacy compatibility, without synthesizing text from excerpts.
    }
    if (node.items === null) {
      if (typeof node.node_id !== 'string' || !node.node_id) return bad('invalid deferred node identity');
      if (node.items_unavailable_reason !== 'response_budget') return bad('null projection requires response_budget');
      deferred = true; continue;
    }
    if (deferred || !Array.isArray(node.items) || Object.hasOwn(node, 'items_unavailable_reason') || typeof node.node_id !== 'string' || !node.node_id) return bad('invalid whole-node item projection');
    const ids = new Set<string>();
    for (const item of node.items) {
      if (!isObject(item) || typeof item.item_identity !== 'string' || !item.item_identity || ids.has(item.item_identity)) return bad('invalid or duplicate saved item identity');
      ids.add(item.item_identity);
      let allowed: string[];
      switch (item.kind) {
        case 'text': {
          allowed = ['kind', 'item_identity', 'text', 'text_complete'];
          if (typeof item.text !== 'string' || typeof item.text_complete !== 'boolean') return bad('invalid authoritative text');
          const length = encoder.encode(item.text).length; bytes += length;
          if (length > 16384 || bytes > 4194304) return bad('history item text budget exceeded');
          break;
        }
        case 'tool_call': case 'tool_result':
          allowed = ['kind', 'item_identity', 'execution_ids', 'descriptor', 'detail_availability'];
          if (!Array.isArray(item.execution_ids) || item.execution_ids.length > 8 || !item.execution_ids.every(id => typeof id === 'string' && id.length > 0)) return bad('invalid execution identities');
          if (Object.hasOwn(item, 'descriptor') !== Object.hasOwn(item, 'detail_availability')) return bad('partial tool metadata');
          if (Object.hasOwn(item, 'descriptor')) {
            if (!validToolDescriptor(item.descriptor, item.kind === 'tool_result')) return bad('invalid tool descriptor');
            if (item.detail_availability !== 'execution_linked' && item.detail_availability !== 'unavailable') return bad('invalid tool detail availability');
            if ((item.detail_availability === 'execution_linked') !== (item.execution_ids.length > 0)) return bad('inconsistent tool routing');
            bytes += encoder.encode(typeof item.descriptor.call_id === 'string' ? item.descriptor.call_id : '').length
              + encoder.encode(typeof item.descriptor.name === 'string' ? item.descriptor.name : '').length;
            if (bytes > 4194304) return bad('history item metadata budget exceeded');
          }
          break;
        case 'reasoning_unavailable': allowed = ['kind', 'item_identity']; break;
        case 'unavailable':
          allowed = ['kind', 'item_identity', 'reason'];
          if (typeof item.reason !== 'string' || !historyItemReasons.has(item.reason)) return bad('invalid unavailable reason');
          break;
        default: return bad('unknown history item kind');
      }
      if (Object.keys(item).some(key => !allowed.includes(key))) return bad('unexpected saved item field');
    }
  }
  return { ok: true, value: {...v,items:(v.items as unknown as HistoryItem[]).map(sanitizeMessageRelation)} as unknown as HistoryWindowResult };
};
