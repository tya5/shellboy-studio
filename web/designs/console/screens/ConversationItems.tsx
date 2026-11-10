import type {OwnSendPlacement} from "../../../ui-core/src/own-send-region";
import { Fragment, type ComponentChildren } from 'preact';

/** Internal normalized presentation input, not a Core wire DTO or a body proof. */
export type ConversationItemSource = import("../../../ui-core/src/conversation-items").NormalizedSavedItem;
export interface ConversationItem {
  readonly classification?: import("../../../ui-core/src/conversation-items").CanonicalCase;
  key: string;
  source: ConversationItemSource;
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
  localRegion?:{placement:OwnSendPlacement;content:ComponentChildren};
  isItemHidden?: (item: ConversationItem) => boolean;
  renderHeading?: (summary: ConversationToolSummary) => ComponentChildren;
}

/** Projection owns classification and membership; presentation only follows its sequence. */
export function ConversationItems({ items, toolSummaries = [], renderItem, renderHeading, renderBefore, trailing, isItemHidden, sequence, workGroups, renderWorkGroup,localRegion }: Props) {
  if (sequence && workGroups && renderWorkGroup) {
    const byKey = new Map(items.map(item => [item.key, item]));
    const groups = new Map(workGroups.map(group => [group.key, group]));
    const content = (item: ConversationItem, work: boolean) => <div class="conversation-row" key={`item:${item.key}`} data-item-key={item.key} data-key={item.key} data-node={item.source.nodeId} data-work-item-key={work ? item.key : undefined}>{renderItem(item)}</div>;
    const insertion=localRegion?.placement.kind==="qualified"?localRegion.placement.insertion:undefined;
    const same=(entry:NonNullable<Props["sequence"]>[number])=>insertion?.kind===entry.kind&&(entry.kind==="conversation"?insertion.kind==="conversation"&&insertion.itemKey===entry.itemKey:insertion.kind==="work"&&insertion.groupKey===entry.groupKey);
    const canonical=sequence.map(entry => {
      if (entry.kind === "conversation") {
        const item = byKey.get(entry.itemKey);
        return item ? <Fragment key={`conversation:${item.key}`}>{renderBefore?.(item)}{content(item, false)}</Fragment> : null;
      }
      const group = groups.get(entry.groupKey);
      if (!group) return null;
      return <div key={`work:${group.key}`} class="conversation-row steps">{renderWorkGroup(group, group.memberKeys.map(key => {
        const item = byKey.get(key); return item ? content(item, true) : null;
      }))}</div>;
    });
    const region:ComponentChildren[]=[];
    if(insertion?.kind==="beginning")region.push(localRegion?.content);
    canonical.forEach((row,index)=>{if(Array.isArray(row))region.push(...row);else region.push(row);if(same(sequence[index]!))region.push(localRegion?.content);});
    if(!insertion)region.push(localRegion?.content);
    return <div class="conversation-items">{region}{trailing}</div>;
  }
  const rows: ComponentChildren[] = [];
  for (const item of items) {
    if (renderBefore) rows.push(renderBefore(item));
    for (const summary of toolSummaries) {
      if (summary.memberKeys[0] === item.key && renderHeading) rows.push(
        <div key={`heading:${summary.anchorKey}`} data-item-heading="" data-key={summary.anchorKey} data-heading-anchor-key={summary.anchorKey} data-heading-member-keys={JSON.stringify(summary.memberKeys)}>
          {renderHeading(summary)}
        </div>,
      );
    }
    rows.push(<div hidden={isItemHidden?.(item)} class="conversation-row" key={`item:${item.key}`} data-item-key={item.key} data-key={item.key}
      data-node={item.source.nodeId} data-execution-id={item.source.kind === 'tool' && !item.source.executionIds ? item.source.executionId : undefined}>
      {renderItem(item)}
    </div>);
  }
  return <div class="conversation-items">{rows}{trailing}</div>;
}
