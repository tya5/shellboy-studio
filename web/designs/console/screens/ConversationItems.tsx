import { Fragment, type ComponentChildren } from 'preact';
import type { PendingOwnMessage } from '../../../ui-core/src/model';
import type { OwnSendTailRow } from '../../../ui-core/src/own-send-presentation';

/** Internal normalized presentation input, not a Core wire DTO or a body proof. */
export type ConversationItemSource = import("../../../ui-core/src/conversation-items").NormalizedSavedItem;
export interface ConversationItem {
  readonly classification?: import("../../../ui-core/src/conversation-items").CanonicalCase;
  key: string;
  source: ConversationItemSource;
  readonly presentationContainer?: string;
  readonly outerRowKey?: string;
}
export interface ConversationToolSummary {
  continuationBefore?: "unknown" | "closed";
  continuationAfter?: "unknown" | "closed";
  anchorKey: string;
  memberKeys: readonly string[];
  executionIds: readonly string[];
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
  sequence?: readonly ({ kind: "conversation"; itemKey: string } | { kind: "work"; groupKey: string })[];
  workGroups?: readonly ConversationWorkGroup[];
  renderWorkGroup?: (group: ConversationWorkGroup, children: ComponentChildren) => ComponentChildren;
  items: readonly ConversationItem[];
  toolSummaries?: readonly ConversationToolSummary[];
  partitionUnknownKeys?: readonly string[];
  renderItem: (item: ConversationItem) => ComponentChildren;
  renderBefore?: (item: ConversationItem) => ComponentChildren;
  trailing?: ComponentChildren;
  localRegion?: { readonly kind: "unqualified"; readonly tailRows: readonly OwnSendTailRow[]; readonly renderRow: (row: PendingOwnMessage) => ComponentChildren };
  isItemAbsent?: (item: ConversationItem) => boolean;
  isItemHidden?: (item: ConversationItem) => boolean;
  renderHeading?: (summary: ConversationToolSummary) => ComponentChildren;
}

/** Projection owns classification and membership; presentation only follows its sequence. */
export function ConversationItems({ items, toolSummaries = [], renderItem, renderHeading, renderBefore, trailing, isItemAbsent, isItemHidden, sequence, workGroups, renderWorkGroup,localRegion }: Props) {
  const normalizedSequence = sequence ?? (localRegion ? items.map(item => ({ kind: "conversation" as const, itemKey: item.key })) : undefined);
  const normalizedGroups = workGroups ?? [];
  const normalizedRenderWorkGroup = renderWorkGroup ?? ((_group: ConversationWorkGroup, children: ComponentChildren) => children);
  if (normalizedSequence) {
    const byKey = new Map(items.map(item => [item.key, item]));
    const groups = new Map(normalizedGroups.map(group => [group.key, group]));
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
    const keyForSavedItem = (item: ConversationItem) => item.outerRowKey ?? item.key;
    const row = (key: string, children: ComponentChildren, item?: ConversationItem, work = false, hosted = false) =>
      <div class={`conversation-row${hosted ? " conversation-answer-child" : ""}`} key={`item:${key}`} data-item-key={item?.key} data-key={item?.key} data-node={item?.source.nodeId} data-work-item-key={work ? item?.key : undefined} data-own-presentation={item ? undefined : ""} data-own-placement={item ? undefined : "suffix"}>{children}</div>;
    const content = (item: ConversationItem, work: boolean, hosted = !work && !!item.presentationContainer) => row(keyForSavedItem(item), renderItem(item), item, work, hosted);
    const renderWork = (entry: Extract<NonNullable<Props["sequence"]>[number], { kind: "work" }>): ComponentChildren => {
      const group = groups.get(entry.groupKey);
      return group ? <div key={`work:${group.key}`} class="conversation-row steps">{normalizedRenderWorkGroup(group, group.memberKeys.map(key => {
        const item = byKey.get(key); return item ? content(item, true, false) : null;
      }))}</div> : null;
    };
    const renderPosition = (position: number, hostedContainer?: string): ComponentChildren[] => {
      const entry = normalizedSequence[position]!;
      const output: ComponentChildren[] = [];
      if (entry.kind === "work") {
        const work = renderWork(entry); if (work) output.push(work);
      } else {
        const item = byKey.get(entry.itemKey);
        if (item && !isItemAbsent?.(item)) output.push(<Fragment key={`conversation:${keyForSavedItem(item)}`}>{renderBefore?.(item)}{content(item, false, hostedContainer !== undefined)}</Fragment>);
      }
      return output;
    };
    const rendered: { entry: NonNullable<Props["sequence"]>[number]; view: ComponentChildren }[] = [];
    for (let index = 0; index < normalizedSequence.length; index++) {
      const entry = normalizedSequence[index]!;
      const span = spans.get(index);
      if (span) {
        const children: ComponentChildren[] = [];
        for (let position = index; position <= span.end; position++) children.push(...renderPosition(position, span.container));
        rendered.push({ entry, view: <div class="conversation-row answer-container" key={`answer:${span.container}`} data-answer-container={span.container}>{children}</div> });
        index = span.end;
        continue;
      }
      const unsafe = entry.kind === "conversation" && !!containerAt(index) && invalidContainers.has(containerAt(index)!);
      const nodes = renderPosition(index, unsafe ? undefined : containerAt(index));
      if (nodes.length) rendered.push({ entry, view: nodes });
    }
    const tailRows = localRegion?.kind === "unqualified" ? localRegion.tailRows : [];
    const pendingRows = localRegion?.kind === "unqualified"
      ? tailRows.map(tail => {
        if (tail.kind === "live") return content(tail.item, false, false);
        const key = tail.outerRowKey;
        return <Fragment key={`conversation:${key}`}>{undefined}{row(key, localRegion.renderRow(tail.row))}</Fragment>;
      })
      : [];
    // Use the captured row identity without changing canonical measurement keys.
    const directChildren = (views: readonly ComponentChildren[]): ComponentChildren[] => views.flatMap(view => Array.isArray(view) ? view : [view]);
    const rowViews = directChildren([...rendered.map(row => row.view), trailing, ...pendingRows]);
    return <div class="conversation-items">{rowViews}</div>;
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
