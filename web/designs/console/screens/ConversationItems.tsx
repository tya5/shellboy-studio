import type {OwnSendInsertion,OwnSendPlacement} from "../../../ui-core/src/own-send-region";
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
  localRegion?:{placement:OwnSendPlacement;content:ComponentChildren;slots?:readonly {insertion:OwnSendInsertion;content:ComponentChildren}[];unqualified?:ComponentChildren};
  isItemAbsent?: (item: ConversationItem) => boolean;
  isItemHidden?: (item: ConversationItem) => boolean;
  renderHeading?: (summary: ConversationToolSummary) => ComponentChildren;
}

/** Projection owns classification and membership; presentation only follows its sequence. */
export function ConversationItems({ items, toolSummaries = [], renderItem, renderHeading, renderBefore, trailing, isItemAbsent, isItemHidden, sequence, workGroups, renderWorkGroup,localRegion }: Props) {
  if (sequence && renderWorkGroup) {
    const byKey = new Map(items.map(item => [item.key, item]));
    const groups = new Map((workGroups ?? []).map(group => [group.key, group]));
    const content = (item: ConversationItem, work: boolean) => <div class={`conversation-row${!work && item.presentationContainer ? " conversation-answer-child" : ""}`} key={`item:${item.key}`} data-item-key={item.key} data-key={item.key} data-node={item.source.nodeId} data-work-item-key={work ? item.key : undefined}>{renderItem(item)}</div>;
    const insertion=localRegion?.placement.kind==="qualified"?localRegion.placement.insertion:undefined;
    const same=(entry:NonNullable<Props["sequence"]>[number])=>insertion?.kind===entry.kind&&(entry.kind==="conversation"?insertion.kind==="conversation"&&insertion.itemKey===entry.itemKey:insertion.kind==="work"&&insertion.groupKey===entry.groupKey);
    const rendered: { entry: NonNullable<Props["sequence"]>[number]; view: ComponentChildren }[] = [];
    for (let index = 0; index < sequence.length; index++) {
      const entry = sequence[index]!;
      if (entry.kind === "conversation") {
        const item = byKey.get(entry.itemKey);
        if (!item || isItemAbsent?.(item)) continue;
        const container = (item as ConversationItem & { presentationContainer?: string }).presentationContainer;
        if (!container) {
          rendered.push({ entry, view: <Fragment key={`conversation:${item.key}`}>{renderBefore?.(item)}{content(item, false)}</Fragment> });
          continue;
        }
        const children: ComponentChildren[] = [];
        let end = index;
        while (end < sequence.length) {
          const childEntry = sequence[end]!;
          if (childEntry.kind !== "conversation") break;
          const child = byKey.get(childEntry.itemKey);
          if (!child || (child as ConversationItem & { presentationContainer?: string }).presentationContainer !== container) break;
          if (!isItemAbsent?.(child)) {
            const childSlots = (localRegion?.slots ?? []).filter(slot => slot.insertion.kind === "conversation" && slot.insertion.itemKey === childEntry.itemKey);
            children.push(<Fragment key={`answer-child:${child.key}`}>{renderBefore?.(child)}{content(child, false)}{childSlots.map(slot => slot.content)}{!localRegion?.slots?.length && insertion?.kind === "conversation" && insertion.itemKey === childEntry.itemKey ? localRegion?.content : null}</Fragment>);
          }
          end++;
        }
        rendered.push({ entry, view: <div class="conversation-row answer-container" key={`answer:${container}`} data-answer-container={container}>{children}</div> });
        index = end - 1;
        continue;
      }
      const group = groups.get(entry.groupKey);
      if (!group) continue;
      rendered.push({ entry, view: <div key={`work:${group.key}`} class="conversation-row steps">{renderWorkGroup(group, group.memberKeys.map(key => {
        const item = byKey.get(key); return item ? content(item, true) : null;
      }))}</div> });
    }
    if (sequence.length === 0) {
      const emptyRegion: ComponentChildren[] = [];
      if (localRegion?.placement.kind === "unqualified") emptyRegion.push(localRegion.unqualified);
      else if (slots.length) emptyRegion.push(...slots.filter(slot => slot.insertion.kind === "beginning").map(slot => slot.content));
      else if (insertion?.kind === "beginning") emptyRegion.push(localRegion?.content);
      return <div class="conversation-items">{emptyRegion}{trailing}</div>;
    }
    const canonical = rendered.map(item => item.view);
    const canonicalEntries = rendered.map(item => item.entry);
    const region:ComponentChildren[]=[];
    const slots = localRegion?.slots ?? [];
    const renderInsertion = (kind: NonNullable<OwnSendInsertion>["kind"], key?: string) => {
      for (const slot of slots) {
        if (slot.insertion.kind !== kind) continue;
        if (kind === "conversation" && slot.insertion.itemKey !== key) continue;
        if (kind === "work" && slot.insertion.groupKey !== key) continue;
        region.push(slot.content);
      }
    };
    if (localRegion?.placement.kind === "unqualified") region.push(localRegion.unqualified);
    else if (insertion?.kind === "beginning") {
      if (slots.length) renderInsertion("beginning");
      else region.push(localRegion?.content);
    }
    canonical.forEach((row,index)=>{if(Array.isArray(row))region.push(...row);else region.push(row);
      const entry=canonicalEntries[index]!;
      const grouped = entry.kind === "conversation" && byKey.get(entry.itemKey)?.presentationContainer !== undefined;
      if (!grouped) {
        renderInsertion(entry.kind, entry.kind === "conversation" ? entry.itemKey : entry.groupKey);
        if(!localRegion?.slots?.length&&same(entry))region.push(localRegion?.content);
      }
    });
    if (insertion?.kind === "conversation" || insertion?.kind === "work") {
      if (!slots.length && insertion.kind === "conversation") {
        const target = canonicalEntries.find(entry => entry.kind === "conversation" && entry.itemKey === insertion.itemKey);
        if (!target) region.push(localRegion?.content);
      }
    }
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
