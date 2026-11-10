import type { ComponentChildren } from 'preact';

/** Internal normalized presentation input, not a Core wire DTO or a body proof. */
export interface ConversationItemSource {
  nodeId: string;
  itemIdentity: string;
  revision?: string;
  windowRevision?: string | number;
  kind: 'text' | 'tool' | 'reasoning' | 'reasoning_unavailable' | 'unknown' | 'unavailable';
  text?: string;
  executionId?: string;
  executionIds?: readonly string[];
}
export interface ConversationItem {
  key: string;
  source: ConversationItemSource;
}
export interface ConversationToolSummary {
  anchorKey: string;
  memberKeys: readonly string[];
  executionIds: readonly string[];
}
interface Props {
  items: readonly ConversationItem[];
  toolSummaries?: readonly ConversationToolSummary[];
  partitionUnknownKeys?: readonly string[];
  renderItem: (item: ConversationItem) => ComponentChildren;
  renderBefore?: (item: ConversationItem) => ComponentChildren;
  trailing?: ComponentChildren;
  renderHeading?: (summary: ConversationToolSummary) => ComponentChildren;
}

/** Content always has one parent. Summary chrome is a sibling, never an owner. */
export function ConversationItems({ items, toolSummaries = [], renderItem, renderHeading, renderBefore, trailing }: Props) {
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
    rows.push(<div class="conversation-row" key={`item:${item.key}`} data-item-key={item.key} data-key={item.key}
      data-node={item.source.nodeId} data-execution-id={item.source.kind === 'tool' && !item.source.executionIds ? item.source.executionId : undefined}>
      {renderItem(item)}
    </div>);
  }
  return <div class="conversation-items">{rows}{trailing}</div>;
}
