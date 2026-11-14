import type {OwnSendPlacement} from "../../../ui-core/src/own-send-region";
import type {OwnSendSlotPosition} from "../../../ui-core/src/own-send-presentation";
import { Fragment, type ComponentChildren } from 'preact';

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
  localRegion?:{placement:OwnSendPlacement;slots?:readonly {position:OwnSendSlotPosition;content:ComponentChildren}[];unqualified?:ComponentChildren};
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
    const slots = localRegion?.slots ?? [];
    const slotsAt = (position: number): ComponentChildren[] => slots.filter(slot => slot.position.kind === "after" && slot.position.index === position).map(slot => slot.content);
    const beforeFirstSlots = slots.filter(slot => slot.position.kind === "before-first").map(slot => slot.content);
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
    const content = (item: ConversationItem, work: boolean, hosted = !work && !!item.presentationContainer) => <div class={`conversation-row${hosted ? " conversation-answer-child" : ""}`} key={`item:${item.key}`} data-item-key={item.key} data-key={item.key} data-node={item.source.nodeId} data-work-item-key={work ? item.key : undefined}>{renderItem(item)}</div>;
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
        if (item && !isItemAbsent?.(item)) output.push(<Fragment key={`conversation:${item.key}`}>{renderBefore?.(item)}{content(item, false, hostedContainer !== undefined)}</Fragment>);
      }
      output.push(...slotsAt(position));
      return output;
    };
    const rendered: { entry: NonNullable<Props["sequence"]>[number]; view: ComponentChildren; first:number; last:number }[] = [];
    for (let index = 0; index < normalizedSequence.length; index++) {
      const entry = normalizedSequence[index]!;
      const span = spans.get(index);
      if (span) {
        const children: ComponentChildren[] = [];
        for (let position = index; position <= span.end; position++) children.push(...renderPosition(position, span.container));
        rendered.push({ entry, view: <div class="conversation-row answer-container" key={`answer:${span.container}`} data-answer-container={span.container}>{children}</div>, first:index, last:span.end });
        index = span.end;
        continue;
      }
      const unsafe = entry.kind === "conversation" && !!containerAt(index) && invalidContainers.has(containerAt(index)!);
      const nodes = renderPosition(index, unsafe ? undefined : containerAt(index));
      if (nodes.length) rendered.push({ entry, view: <>{nodes}</>, first:index, last:index });
    }
    const plan = localRegion?.placement.kind === "unqualified" && localRegion.unqualified
      ? [{ view: localRegion.unqualified, first: -1, last: -1 }, ...rendered]
      : rendered;
    const region:ComponentChildren[] = [...beforeFirstSlots, ...plan.map(row => row.view)];
    return <div class="conversation-items">{region}{trailing}</div>;
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
