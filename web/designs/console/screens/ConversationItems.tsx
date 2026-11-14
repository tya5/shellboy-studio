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
    const emittedSlots = new Set<object>();
    const emitSlotsAt = (position:number): ComponentChildren[] => slots.filter(slot => slot.position.kind === "after" && slot.position.index === position && !emittedSlots.has(slot)).map(slot => { emittedSlots.add(slot); return slot.content; });
    const containerAt = (position: number): string | undefined => {
      const entry = normalizedSequence[position];
      if (!entry || entry.kind !== "conversation") return undefined;
      return byKey.get(entry.itemKey)?.presentationContainer;
    };
    // Build one span for each association only when its interval contains no other
    // association. Work and local slots may live inside that span without changing
    // the authoritative sequence; crossing ownership remains unqualified.
    const spans = new Map<number, { end: number; container: string }>();
    const invalidContainers = new Set<string>();
    for (let index = 0; index < normalizedSequence.length; index++) {
      const container = containerAt(index);
      if (!container) continue;
      const positions = normalizedSequence.flatMap((_, position) => containerAt(position) === container ? [position] : []);
      const end = positions.at(-1)!;
      if (normalizedSequence.slice(index, end + 1).some((_, offset) => {
        const other = containerAt(index + offset);
        return other !== undefined && other !== container;
      })) invalidContainers.add(container);
      else if (index === positions[0]) spans.set(index, { end, container });
    }
    const content = (item: ConversationItem, work: boolean, hosted = !work && !!item.presentationContainer) => <div class={`conversation-row${hosted ? " conversation-answer-child" : ""}`} key={`item:${item.key}`} data-item-key={item.key} data-key={item.key} data-node={item.source.nodeId} data-work-item-key={work ? item.key : undefined}>{renderItem(item)}</div>;
    const renderWork = (entry: Extract<NonNullable<Props["sequence"]>[number], { kind: "work" }>): ComponentChildren => {
      const group = groups.get(entry.groupKey);
      return group ? <div key={`work:${group.key}`} class="conversation-row steps">{normalizedRenderWorkGroup(group, group.memberKeys.map(key => {
        const item = byKey.get(key); return item ? content(item, true, false) : null;
      }))}</div> : null;
    };
    const rendered: { entry: NonNullable<Props["sequence"]>[number]; view: ComponentChildren; first:number; last:number }[] = [];
    for (let index = 0; index < normalizedSequence.length; index++) {
      const entry = normalizedSequence[index]!;
      const span = spans.get(index);
      if (span && !invalidContainers.has(span.container)) {
        const children: ComponentChildren[] = [];
        for (let position = index; position <= span.end; position++) {
          const childEntry = normalizedSequence[position]!;
          if (childEntry.kind === "work") children.push(renderWork(childEntry));
          else {
            const child = byKey.get(childEntry.itemKey);
            if (child && !isItemAbsent?.(child)) children.push(<Fragment key={`answer-child:${child.key}`}>{renderBefore?.(child)}{content(child, false, true)}{emitSlotsAt(position)}</Fragment>);
          }
        }
        rendered.push({ entry, view: <div class="conversation-row answer-container" key={`answer:${span.container}`} data-answer-container={span.container}>{children}</div>, first:index, last:span.end });
        index = span.end;
        continue;
      }
      if (entry.kind === "work") { rendered.push({ entry, view: renderWork(entry), first:index, last:index }); continue; }
      const item = byKey.get(entry.itemKey);
      if (!item || isItemAbsent?.(item)) continue;
      const unsafe = !!item.presentationContainer && invalidContainers.has(item.presentationContainer);
      rendered.push({ entry, view: <Fragment key={`conversation:${item.key}`}>{renderBefore?.(item)}{content(item, false, !unsafe && !!item.presentationContainer)}{emitSlotsAt(index)}</Fragment>, first:index, last:index });
    }
    const region:ComponentChildren[]=[];
    if (localRegion?.placement.kind === "unqualified") region.push(localRegion.unqualified);
    const slotPosition=(slot:{position:OwnSendSlotPosition})=>slot.position.kind==="before-first"?-1:slot.position.index;
    const ownedSlots=[...slots].sort((a,b)=>slotPosition(a)-slotPosition(b));
    let slotIndex=0;
    rendered.forEach(row=>{
      while(slotIndex<ownedSlots.length&&slotPosition(ownedSlots[slotIndex]!)<row.first){const slot=ownedSlots[slotIndex++]!;if(!emittedSlots.has(slot)){emittedSlots.add(slot);region.push(slot.content);}}
      region.push(row.view);
      while(slotIndex<ownedSlots.length&&slotPosition(ownedSlots[slotIndex]!)<=row.last){const slot=ownedSlots[slotIndex++]!;if(!emittedSlots.has(slot)){emittedSlots.add(slot);region.push(slot.content);}}
    });
    while(slotIndex<ownedSlots.length){const slot=ownedSlots[slotIndex++]!;if(!emittedSlots.has(slot)){emittedSlots.add(slot);region.push(slot.content);}}
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
