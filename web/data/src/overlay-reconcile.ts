/** Transport-free association scaffold; no Core wire interpretation or preview admission. */
export interface OverlayToken {
  readonly owner: string;
  readonly session: number;
  readonly scope: string;
  readonly generation: number;
}
export interface OverlayRecord {
  readonly key: string;
  readonly attemptId: string;
  readonly text: string;
}
export interface OverlayAssociation {
  readonly key: string;
  readonly nodeId: string;
  readonly itemId: string;
  readonly revision: string;
}
export interface OverlayState {
  readonly token: OverlayToken;
  readonly records: readonly OverlayRecord[];
  readonly associations: readonly OverlayAssociation[];
  readonly lookup?: number;
  readonly starts: number;
}
export type OverlayAction =
  | { readonly type: 'begin'; readonly token: OverlayToken; readonly operation: number }
  | { readonly type: 'settled'; readonly operation: number }
  | { readonly type: 'proof'; readonly token: OverlayToken; readonly key: string; readonly attemptId: string; readonly nodeId: string; readonly itemId: string; readonly revision: string; readonly loaded: boolean; readonly visible: boolean; readonly safeBody: boolean }
  | { readonly type: 'reconcile'; readonly token: OverlayToken };
export function overlayState(token: OverlayToken, records: readonly OverlayRecord[]): OverlayState {
  return { token, records, associations: [], starts: 0 };
}
export function reconcileOverlay(state: OverlayState, _action: OverlayAction): OverlayState {
  return state;
}
