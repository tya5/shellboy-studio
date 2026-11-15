import type {Outcome} from './errors';
export class InputCaptureError extends Error {
 constructor(readonly reason:'input-bound'|'invalid-input'|'cyclic-input'){
  super(reason==='input-bound'?'accepted view staging bound exceeded':reason==='cyclic-input'?'accepted view requires acyclic data':'accepted view requires plain data');
 }
}
export interface InputCapture {<T>(value:T):T;readonly visits?:number}
export function createInputCapture(preserveIdentity:(value:object)=>boolean=()=>false): InputCapture {
  let nodes = 0;
  const active = new Set<object>();
  const provenance = new Map<string, { readonly value: unknown; readonly height: number }>();
  const captured = new Map<object, { readonly value: unknown; readonly height: number }>();
  const copy = (v: unknown, depth: number, field?: string): unknown => {
    if (++nodes > 65536 || depth > 64) throw new InputCaptureError("input-bound");
    if (v !== null && typeof v === "object" && preserveIdentity(v)) return v;
    if (v === null || typeof v !== "object") {
      if (typeof v === "function" || typeof v === "symbol") throw new InputCaptureError("invalid-input");
      return v;
    }
    if (active.has(v)) throw new InputCaptureError("cyclic-input");
    const prior = captured.get(v);
    if (prior) {
      if (depth + prior.height > 64) throw new InputCaptureError("input-bound");
      return prior.value;
    }
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new InputCaptureError("invalid-input");
    active.add(v);
    let height = 0;
    const child = (item: unknown, key?: string): unknown => {
      const result = copy(item, depth + 1, key);
      const childHeight = result !== null && typeof result === 'object' ? captured.get(result)?.height ?? 0 : 0;
      height = Math.max(height, childHeight + 1);
      return result;
    };
    // One publication graph: rows/plan/group aliases share one immutable capture,
    // rather than expanding the same subtree again for each presentation path.
    let result: unknown;
    if (Array.isArray(v)) result = v.map(item => child(item));
    else {
      const object: Record<string, unknown> = {};
      for (const key of Object.keys(v)) {
        const value = child((v as Record<string, unknown>)[key], key);
        // An own __proto__ key is data, never an assignment to the prototype setter.
        if (key === '__proto__') Object.defineProperty(object, key, {value, enumerable:true, configurable:true, writable:true});
        else object[key] = value;
      }
      result = object;
    }
    active.delete(v);
    let snapshot: { readonly value: unknown; readonly height: number } = { value: Object.freeze(result), height };
    if (field === "provenance") {
      // Only the already materialized plain value is fingerprinted. No raw getter,
      // toJSON, prototype or deep input traversal can run outside this one budget.
      let token = false;
      const key = JSON.stringify(snapshot.value, (_key, item: unknown) => {
        if (item !== null && typeof item === "object" && preserveIdentity(item)) token = true;
        return item;
      });
      if (!token) {
        const prior = provenance.get(key);
        if (prior) snapshot = prior;
        else provenance.set(key, snapshot);
      }
    }
    captured.set(v, snapshot);
    if (snapshot.value !== null && typeof snapshot.value === "object") captured.set(snapshot.value, snapshot);
    return snapshot.value;
  };
  const capture:InputCapture=<T>(value:T):T=>copy(value,0) as T;
  Object.defineProperty(capture,'visits',{get:()=>nodes});return capture;
}


/** Capture an untrusted response once, then shape only the owned graph. */
export function captureDecode<T>(raw: unknown, decode: (owned: unknown, visits: number) => T): Outcome<T> {
  try {
    const capture = createInputCapture();
    return { ok: true, value: decode(capture(raw), capture.visits ?? 0) };
  } catch (error) {
    return { ok: false, error: { kind: "invalid_response", message: error instanceof InputCaptureError ? error.reason : "invalid-input" } };
  }
}
