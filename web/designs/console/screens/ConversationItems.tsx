import { useContext, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { conversationViewport } from "./conversationViewport";
import { ViewportGeometry } from "./viewportGeometry";
import { Fragment, type ComponentChildren, type RefCallback } from 'preact';
import { canonicalSavedItemKey } from "../../../ui-core/src/conversation-items";
import type { PendingOwnMessage } from '../../../ui-core/src/model';
import type { PositionedOwnSendRow } from '../../../ui-core/src/own-send-presentation';

/** Internal normalized presentation input, not a Core wire DTO or a body proof. */
export type ConversationItemSource = import("../../../ui-core/src/conversation-items").NormalizedSavedItem;
export interface ConversationItem {
  readonly classification?: import("../../../ui-core/src/conversation-items").CanonicalCase;
  key: string;
  source: ConversationItemSource;
  readonly presentationContainer?: string;
}
export interface ConversationToolSummary {
  continuationBefore?: "unknown" | "closed";
  continuationAfter?: "unknown" | "closed";
  anchorKey: string;
  memberKeys: readonly string[];
  executionIds: readonly string[];
}
export interface WindowedWorkGroup {
  readonly headingVisible: boolean;
  readonly headingRef?: RefCallback<HTMLElement>;
}
export interface ConversationWorkGroup {
  readonly categoryCounts?: Readonly<Record<"Tools" | "Reasoning" | "Notifications" | "Problems", number>>;
  key: string;
  firstMemberKey: string;
  memberKeys: readonly string[];
  executionIds: readonly string[];
  toolItemKeys: readonly string[];
  unknownToolCount: number;
  interrupted: boolean;
  continuationBefore?: "unknown" | "closed";
  continuationAfter?: "unknown" | "closed";
}

interface Props {
  ordinalByNode?: ReadonlyMap<string, number>;
  sequence?: readonly ({ kind: "conversation"; itemKey: string } | { kind: "work"; groupKey: string })[];
  workGroups?: readonly ConversationWorkGroup[];
  renderWorkGroup?: (group: ConversationWorkGroup, children: ComponentChildren, window?: WindowedWorkGroup) => ComponentChildren;
  groupOpen?: ReadonlyMap<string, boolean>;
  items: readonly ConversationItem[];
  toolSummaries?: readonly ConversationToolSummary[];
  partitionUnknownKeys?: readonly string[];
  renderItem: (item: ConversationItem) => ComponentChildren;
  renderBefore?: (item: ConversationItem) => ComponentChildren;
  trailing?: ComponentChildren;
  localRegion?: { readonly kind: "unqualified"; readonly tailRows: readonly PositionedOwnSendRow[]; readonly renderRow: (row: PendingOwnMessage | Extract<PositionedOwnSendRow, { kind: "live" }>) => ComponentChildren };
  isItemAbsent?: (item: ConversationItem) => boolean;
  isItemHidden?: (item: ConversationItem) => boolean;
  renderHeading?: (summary: ConversationToolSummary) => ComponentChildren;
}

/** Projection owns classification and membership; presentation only follows its sequence. */
export function ConversationItems({ items, toolSummaries = [], renderItem, renderHeading, renderBefore, trailing, isItemAbsent, isItemHidden, sequence, workGroups, renderWorkGroup,localRegion, ordinalByNode, groupOpen }: Props) {
  const normalizedSequence = sequence ?? (localRegion ? items.map(item => ({ kind: "conversation" as const, itemKey: item.key })) : undefined);
  const normalizedGroups = workGroups ?? [];
  const normalizedRenderWorkGroup = renderWorkGroup ?? ((_group: ConversationWorkGroup, children: ComponentChildren) => children);
  const viewport = useContext(conversationViewport);
  const indexed = useMemo(() => {
    if (!normalizedSequence) return undefined;
    const byKey = new Map(items.map(item => [item.key, item]));
    const containerAt = (position: number): string | undefined => {
      const entry = normalizedSequence[position];
      if (!entry || entry.kind !== "conversation") return undefined;
      return byKey.get(entry.itemKey)?.presentationContainer;
    };
    // A span may cross only work entries. Any unowned conversation or crossing
    // association invalidates every intersecting span, leaving canonical order intact.
    const candidates = new Map<string, { start: number; end: number }>();
    for (let index = 0; index < normalizedSequence.length; index++) {
      const container = containerAt(index);
      if (!container) continue;
      const candidate = candidates.get(container);
      candidates.set(container, { start: candidate?.start ?? index, end: index });
    }
    const invalidContainers = new Set<string>();
    for (const [container, span] of candidates) {
      if (!normalizedSequence.slice(span.start, span.end + 1).every((entry, offset) => entry.kind === "work" || containerAt(span.start + offset) === container)) invalidContainers.add(container);
      for (const [other, otherSpan] of candidates) {
        if (other !== container && span.start <= otherSpan.end && otherSpan.start <= span.end) {
          invalidContainers.add(container); invalidContainers.add(other);
        }
      }
    }
    const spans = new Map<number, { end: number; container: string }>();
    for (const [container, span] of candidates) if (!invalidContainers.has(container)) spans.set(span.start, { end: span.end, container });
    const units: { key: string; start: number; end: number; container?: string }[] = [];
    for (let index = 0; index < normalizedSequence.length; index++) {
      const entry = normalizedSequence[index]!;
      const span = spans.get(index);
      units.push({ key: span ? `answer:${span.container}` : entry.kind === "work" ? `work:${entry.groupKey}` : `item:${entry.itemKey}`,
        start: index, end: span?.end ?? index, container: span?.container ?? (entry.kind === "conversation" && !invalidContainers.has(containerAt(index) ?? "") ? containerAt(index) : undefined) });
      if (span) index = span.end;
    }
    return { byKey, units };
  }, [normalizedSequence, items]);
  const grouped = useMemo(() => new Map(normalizedGroups.map(group => [group.key, group])), [workGroups]);
  type Slot = { key: string; position: number; item?: ConversationItem; group?: ConversationWorkGroup; container?: string; heading?: boolean; last?: boolean };
  const slots = useMemo(() => {
    if (!indexed || !normalizedSequence) return [];
    const result: Slot[] = [];
    for (const unit of indexed.units) for (let position = unit.start; position <= unit.end; position++) {
      const entry = normalizedSequence[position]!;
      const container = unit.key.startsWith("answer:") ? unit.container : undefined;
      if (entry.kind === "conversation") {
        const item = indexed.byKey.get(entry.itemKey);
        result.push({ key: `item:${entry.itemKey}`, position, item, container, last: true });
        continue;
      }
      const group = grouped.get(entry.groupKey);
      if (!group) continue;
      const open = groupOpen?.get(group.key) ?? false;
      const first = indexed.byKey.get(group.firstMemberKey);
      result.push({ key: `heading:${group.key}`, position, group, container, item: first, heading: true, last: !open });
      if (open) group.memberKeys.forEach((key, index) => result.push({ key: `item:${key}`, item: indexed.byKey.get(key), position, group, container, last: index === group.memberKeys.length - 1 }));
    }
    return result;
  }, [indexed, normalizedSequence, grouped, groupOpen]);
  const prior = useRef<ViewportGeometry>();
  const committedGeometry = useRef<ViewportGeometry>();
  const geometry = useMemo(() => {
    if (!viewport || !indexed || Math.max(items.length, ordinalByNode?.size ?? 0) <= 8) return undefined;
    const next = new ViewportGeometry(slots.map(slot => slot.key), viewport.fallback, prior.current);
    prior.current = next;
    return next;
  }, [slots, viewport?.fallback]);
  const ordinals = useMemo(() => slots.map(slot => ordinalByNode?.get(slot.item?.source.nodeId ?? "")), [slots, ordinalByNode]);
  const mount = viewport?.mount;
  const mountedRefs = useMemo(() => new Map(slots.map(slot => [slot.key, (node: HTMLElement | null) => mount?.(slot.key, node)])), [slots, mount]);
  const spacers: { from: number; to: number; node: HTMLDivElement }[] = [];
  let top = viewport?.top ?? 0;
  const old = committedGeometry.current;
  if (geometry && old && old !== geometry && !viewport?.following) {
    const from = old.locate(top), key = old.keys[from];
    const to = key === undefined ? undefined : geometry.indexOf(key);
    if (to !== undefined) top += geometry.offset(to) - old.offset(from);
  }
  const [first, end] = geometry && viewport ? geometry.range(top, viewport.height, viewport.following) : [0, indexed?.units.length ?? 0];
  const activeControl = viewport?.focusedKey && document.activeElement instanceof HTMLElement
    && document.activeElement.closest<HTMLElement>("[data-viewport-key]")?.dataset.viewportKey === viewport.focusedKey
    ? document.activeElement : undefined;
  useLayoutEffect(() => {
    // A keyed DOM move can blur its control in a browser. Never override real focus elsewhere.
    if (activeControl?.isConnected && document.activeElement === document.body) activeControl.focus({ preventScroll: true });
    committedGeometry.current = geometry;
    if (!geometry || !viewport) return;
    viewport.commit({ geometry, first, end, ordinals, spacers });
    return () => viewport.commit(undefined);
  });
  if (normalizedSequence) {
    const { byKey, units } = indexed!;
    const groups = grouped;
    const row = (key: string, children: ComponentChildren, item?: ConversationItem, work = false, hosted = false, measure?: RefCallback<HTMLElement>) =>
      <div ref={measure} data-viewport-key={measure ? `item:${key}` : undefined} class={`conversation-row${hosted ? " conversation-answer-child" : ""}`} key={`item:${key}`} data-item-key={item?.key} data-key={item?.key} data-node={item?.source.nodeId} data-work-item-key={work ? item?.key : undefined}
        data-anchor-local={!item?.source.nodeId ? "" : undefined}
        data-handoff-attempt={item?.source.kind === "text" && "domain" in item.source && item.source.domain === "live" && item.source.namespace === "handoff" ? item.source.attemptId : undefined}
        data-own-presentation={item ? undefined : ""} data-own-placement={item ? undefined : "suffix"}>{children}</div>;
    const content = (item: ConversationItem, work: boolean, hosted = !work && !!item.presentationContainer) => row(item.key, renderItem(item), item, work, hosted);
    const renderWork = (entry: Extract<NonNullable<Props["sequence"]>[number], { kind: "work" }>): ComponentChildren => {
      const group = groups.get(entry.groupKey);
      return group ? <div key={`work:${group.key}`} class="conversation-row steps">{normalizedRenderWorkGroup(group, group.memberKeys.map(key => {
        const item = byKey.get(key); return item ? content(item, true, false) : null;
      }))}</div> : null;
    };
    const tailRows = localRegion?.tailRows ?? [];
    const localByPosition = new Map<number, PositionedOwnSendRow[]>();
    for (const tail of tailRows) {
      const group = localByPosition.get(tail.afterSequenceIndex) ?? [];
      group.push(tail);
      localByPosition.set(tail.afterSequenceIndex, group);
    }
    const renderLocalAt = (position: number) => (localByPosition.get(position) ?? []).map(tail => {
      if (tail.kind === "live") return <Fragment key={`conversation:${tail.item.key}`}>{content(tail.item, false, false)}{localRegion!.renderRow(tail)}</Fragment>;
      const id = tail.row.messageId;
      const key = id === undefined ? `own:${tail.row.operationId}` : canonicalSavedItemKey(id, JSON.stringify([id, "/content/0"]));
      return <Fragment key={`conversation:${key}`}>{row(key, localRegion!.renderRow(tail.row))}</Fragment>;
    });
    const renderPosition = (position: number, hostedContainer?: string): ComponentChildren[] => {
      const entry = normalizedSequence[position]!;
      const output: ComponentChildren[] = [];
      if (entry.kind === "work") {
        const work = renderWork(entry); if (work) output.push(work);
      } else {
        const item = byKey.get(entry.itemKey);
        if (item && !isItemAbsent?.(item)) output.push(<Fragment key={`conversation:${item.key}`}>{renderBefore?.(item)}{content(item, false, hostedContainer !== undefined)}</Fragment>);
      }
      return [...output, ...renderLocalAt(position)];
    };
    const renderUnit = (unit: typeof units[number]): ComponentChildren => {
      if (unit.key.startsWith("answer:")) {
        const children: ComponentChildren[] = [];
        for (let position = unit.start; position <= unit.end; position++) children.push(...renderPosition(position, unit.container));
        return <div class="conversation-row answer-container" key={unit.key} data-answer-container={unit.container}>{children}</div>;
      }
      return renderPosition(unit.start, unit.container);
    };
    if (!geometry || !viewport) {
      const views = [...renderLocalAt(-1), ...units.map(renderUnit), trailing];
      return <div class="conversation-items">{views.flatMap(view => Array.isArray(view) ? view : [view])}</div>;
    }
    const measure = (key: string) => mountedRefs.get(key);
    const shown = Array.from({ length: end - first }, (_, offset) => first + offset);
    // Keep at most one extra slot, in its original keyed wrapper and DOM order.
    const focused = viewport.focusedKey === undefined ? undefined : geometry.indexOf(viewport.focusedKey);
    if (focused !== undefined && focused < first) shown.unshift(focused);
    if (focused !== undefined && focused >= end) shown.push(focused);
    const spacer = (from: number, to: number) => from < to ? <div key={`viewport:${from}:${to}`} aria-hidden="true"
      style={{ height: geometry.offset(to) - geometry.offset(from) }} ref={node => { if (node) spacers.push({ from, to, node }); }} /> : null;
    const renderSlice = (from: number, to: number): ComponentChildren[] => {
      const slice: ComponentChildren[] = [];
      for (let i = from; i < to;) {
        const index = shown[i++]!;
        if (i - 1 > from) slice.push(spacer(shown[i - 2]! + 1, index));
        const slot = slots[index]!;
        if (slot.group) {
          const group = slot.group;
          const children: ComponentChildren[] = [];
          const groupRow = (member: Slot) => {
            if (!member.heading && member.item) children.push(row(member.item.key, renderItem(member.item), member.item, true, false, measure(member.key)));
          };
          groupRow(slot);
          let last = slot.last;
          while (i < to && slots[shown[i]!]?.group === group) {
            const previous = shown[i - 1]!, next = shown[i++]!;
            const member = slots[next]!;
            children.push(spacer(previous + 1, next));
            groupRow(member);
            last = member.last;
          }
          slice.push(<div key={`work:${group.key}`} class="conversation-row steps">{normalizedRenderWorkGroup(group, children, { headingVisible: !!slot.heading, headingRef: slot.heading ? measure(slot.key) : undefined })}</div>);
          if (last) slice.push(...renderLocalAt(slot.position));
          continue;
        }
        const item = slot.item;
        if (item && !isItemAbsent?.(item)) slice.push(<Fragment key={`conversation:${item.key}`}>{renderBefore?.(item)}{row(item.key, renderItem(item), item, false, !!slot.container, measure(slot.key))}</Fragment>);
        slice.push(...renderLocalAt(slot.position));
      }
      return slice;
    };
    const views: ComponentChildren[] = [];
    if (shown[0] === 0) views.push(...renderLocalAt(-1));
    for (let i = 0; i < shown.length;) {
      const start = shown[i]!;
      views.push(spacer(i === 0 ? 0 : shown[i - 1]! + 1, start));
      const container = slots[start]?.container;
      let next = i + 1;
      while (next < shown.length && slots[shown[next]!]?.container === container) next++;
      const slice = renderSlice(i, next);
      if (container) views.push(<div class="conversation-row answer-container" key={`answer:${container}`} data-answer-container={container}>{slice}</div>);
      else views.push(...slice);
      i = next;
    }
    const mountedEnd = (shown.at(-1) ?? -1) + 1;
    views.push(spacer(mountedEnd, slots.length), mountedEnd === slots.length ? trailing : null);
    return <div class="conversation-items">{views}</div>;


  }
  const rows: ComponentChildren[] = [];
  for (const item of items) {
    if(isItemAbsent?.(item))continue;
    if (renderBefore) rows.push(renderBefore(item));
    for (const summary of toolSummaries) {
      if (summary.memberKeys[0] === item.key && renderHeading) rows.push(
        <div key={`heading:${summary.anchorKey}`} data-item-heading="" data-key={summary.anchorKey} data-heading-anchor-key={summary.anchorKey} data-heading-member-keys={JSON.stringify(summary.memberKeys)}>
          {renderHeading(summary)}
        </div>,
      );
    }
    rows.push(<div hidden={isItemHidden?.(item)} class={`conversation-row${item.presentationContainer ? " conversation-answer-child" : ""}`} key={`item:${item.key}`} data-item-key={item.key} data-key={item.key}
      data-node={item.source.nodeId} data-execution-id={item.source.kind === 'tool' && !item.source.executionIds ? item.source.executionId : undefined}>
      {renderItem(item)}
    </div>);
  }
  return <div class="conversation-items">{rows}{trailing}</div>;
}
