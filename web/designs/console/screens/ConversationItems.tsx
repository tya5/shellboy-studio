import type {OwnSendPlacement} from "../../../ui-core/src/own-send-region";
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
  localRegion?:{placement:OwnSendPlacement;content:ComponentChildren;slots?:readonly {insertion:OwnSendInsertion;position:number;content:ComponentChildren}[];unqualified?:ComponentChildren};
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
    const content = (item: ConversationItem, work: boolean) => <div class={`conversation-row${!work && item.presentationContainer ? " conversation-answer-child" : ""}`} key={`item:${item.key}`} data-item-key={item.key} data-key={item.key} data-node={item.source.nodeId} data-work-item-key={work ? item.key : undefined}>{renderItem(item)}</div>;
    const rendered: { entry: NonNullable<Props["sequence"]>[number]; view: ComponentChildren; first:number; last:number }[] = [];
    for (let index = 0; index < normalizedSequence.length; index++) {
      const entry = normalizedSequence[index]!;
      if (entry.kind === "conversation") {
        const item = byKey.get(entry.itemKey);
        if (!item || isItemAbsent?.(item)) continue;
        const container = (item as ConversationItem & { presentationContainer?: string }).presentationContainer;
        if (!container) {
          rendered.push({ entry, view: <Fragment key={`conversation:${item.key}`}>{renderBefore?.(item)}{content(item, false)}</Fragment>, first:index, last:index });
          continue;
        }
        const children: ComponentChildren[] = [];
        let end = index;
        while (end < normalizedSequence.length) {
          const childEntry = normalizedSequence[end]!;
          if (childEntry.kind !== "conversation") break;
          const child = byKey.get(childEntry.itemKey);
          if (!child || (child as ConversationItem & { presentationContainer?: string }).presentationContainer !== container) break;
          if (!isItemAbsent?.(child)) {
            children.push(<Fragment key={`answer-child:${child.key}`}>{renderBefore?.(child)}{content(child, false)}</Fragment>);
          }
          end++;
        }
        rendered.push({ entry, view: <div class="conversation-row answer-container" key={`answer:${container}`} data-answer-container={container}>{children}</div>, first:index, last:end-1 });
        index = end - 1;
        continue;
      }
      const group = groups.get(entry.groupKey);
      if (!group) continue;
      rendered.push({ entry, view: <div key={`work:${group.key}`} class="conversation-row steps">{normalizedRenderWorkGroup(group, group.memberKeys.map(key => {
        const item = byKey.get(key); return item ? content(item, true) : null;
      }))}</div>, first:index, last:index });
    }
    const region:ComponentChildren[]=[];
    const slots = localRegion?.slots ?? [];
    if (localRegion?.placement.kind === "unqualified") region.push(localRegion.unqualified);
    const ownedSlots=[...slots].sort((a,b)=>a.position-b.position);
    let slotIndex=0;
    rendered.forEach(row=>{
      while(slotIndex<ownedSlots.length&&ownedSlots[slotIndex]!.position<row.first)region.push(ownedSlots[slotIndex++]!.content);
      region.push(row.view);
      while(slotIndex<ownedSlots.length&&ownedSlots[slotIndex]!.position<=row.last)region.push(ownedSlots[slotIndex++]!.content);
    });
    while(slotIndex<ownedSlots.length)region.push(ownedSlots[slotIndex++]!.content);
    if(localRegion?.placement.kind === "qualified" && !ownedSlots.length)region.push(localRegion.content);
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
