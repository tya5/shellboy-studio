/** LOCAL authority objects only; no wire decoding, preview admission, or store connection. */
declare const associationEvidenceBrand: unique symbol;
export type AssociationEvidence<C extends object> = Readonly<{
  readonly [associationEvidenceBrand]: C;
}>;
export interface OverlayRecord {
  readonly key: string;
  readonly attemptId: string;
  readonly text: string;
}
export interface SavedAssociation {
  readonly nodeId: string;
  readonly itemIdentity: string;
  readonly revision: string;
}
export interface OverlayState<C extends object> {
  readonly capRef: C;
  readonly records: readonly OverlayRecord[];
  readonly associations: readonly Readonly<{ record: OverlayRecord; saved: SavedAssociation }>[];
  readonly lookup?: object;
  readonly starts: number;
}
interface EvidenceFacts<C extends object> {
  readonly capRef: C;
  readonly record: OverlayRecord;
  readonly operation: object;
  readonly saved: SavedAssociation;
}
export type OverlayAction<C extends object> =
  | { readonly type: 'begin'; readonly capRef: C; readonly operation: object }
  | { readonly type: 'settled'; readonly operation: object }
  | { readonly type: 'reconcile'; readonly capRef: C };

export function overlayState<C extends object>(capRef: C, records: readonly OverlayRecord[]): OverlayState<C> {
  if (records.length > 8 || new Set(records.map(r => r.key)).size !== records.length || records.some(r => r.text.length > 262144) || records.reduce((n, r) => n + new TextEncoder().encode(r.text).length, 0) > 1048576) throw new Error('invalid adopted overlay bounds');
  return Object.freeze({ capRef, records: Object.freeze([...records]), associations: Object.freeze([]), starts: 0 });
}
export function reconcileOverlay<C extends object>(state: OverlayState<C>, action: OverlayAction<C>): OverlayState<C> {
  if (action.type === 'settled') {
    if (state.lookup !== action.operation) return state;
    const { lookup: _lookup, ...rest } = state;
    return Object.freeze(rest);
  }
  if (action.type === 'reconcile') {
    if (action.capRef === state.capRef) return state;
    // Invalidation does not release the actual in-flight lookup or refill its budget.
    return Object.freeze({ ...state, capRef: action.capRef, associations: Object.freeze([]) });
  }
  if (action.capRef !== state.capRef || state.lookup || state.starts >= 8) return state;
  return Object.freeze({ ...state, lookup: action.operation, starts: state.starts + 1 });
}

/** The returned issuer closure is retained ONLY by S's validated staging authority. */
export function createAssociationAuthority<C extends object>() {
  const facts = new Map<AssociationEvidence<C>, EvidenceFacts<C>>();
  const byRecord = new Map<OverlayRecord, AssociationEvidence<C>>();
  const forget = (evidence: AssociationEvidence<C>, entry: EvidenceFacts<C>) => {
    facts.delete(evidence);
    if (byRecord.get(entry.record) === evidence) byRecord.delete(entry.record);
  };
  return Object.freeze({
    // Inputs are already materialized by S after loaded/visible/safe-body verification.
    // There is deliberately no public boolean-to-authorization conversion here.
    issue(state: OverlayState<C>, capRef: C, record: OverlayRecord, operation: object, saved: SavedAssociation): AssociationEvidence<C> | undefined {
      if (capRef !== state.capRef || state.lookup !== operation || !state.records.includes(record)) return;
      const previous = byRecord.get(record);
      if (!previous && facts.size >= 8) return;
      if (previous) { const old = facts.get(previous); if (old) forget(previous, old); }
      const evidence = Object.freeze({}) as AssociationEvidence<C>;
      const entry = Object.freeze({ capRef, record, operation, saved: Object.freeze({ nodeId: saved.nodeId, itemIdentity: saved.itemIdentity, revision: saved.revision }) });
      facts.set(evidence, entry); byRecord.set(record, evidence);
      return evidence;
    },
    associate(state: OverlayState<C>, evidence: AssociationEvidence<C>): OverlayState<C> {
      const entry = facts.get(evidence);
      if (!entry || entry.capRef !== state.capRef || entry.operation !== state.lookup || !state.records.includes(entry.record)) return state;
      const associations = state.associations.filter(a => a.record !== entry.record);
      return Object.freeze({ ...state, associations: Object.freeze([...associations, Object.freeze({ record: entry.record, saved: entry.saved })]) });
    },
    // Called after S's successful commit, in notification phase, with original captures.
    release(state: OverlayState<C>, evidence: AssociationEvidence<C>, record: OverlayRecord, operation: object, capRef: C): OverlayState<C> {
      const entry = facts.get(evidence);
      if (!entry || entry.record !== record || entry.operation !== operation || entry.capRef !== capRef || state.capRef !== capRef || state.lookup !== operation || !state.records.includes(record)) return state;
      const accepted = state.associations.some(a => a.record === record && a.saved === entry.saved);
      if (!accepted) return state;
      forget(evidence, entry);
      return Object.freeze({ ...state, records: Object.freeze(state.records.filter(r => r !== record)), associations: Object.freeze(state.associations.filter(a => a.record !== record)) });
    },
    invalidate(): void { facts.clear(); byRecord.clear(); },
    dispose(): void { facts.clear(); byRecord.clear(); },
  });
}
