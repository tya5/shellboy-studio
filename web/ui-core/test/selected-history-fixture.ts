import type { HistoryItem, HistoryWindowArgs } from '../../data/src/protocol';

export function selectedCoverageWindow(threadId:string,revision:number,total:number,items:readonly HistoryItem[],
 args:Pick<HistoryWindowArgs,'node_id'|'ordinal'|'before'|'after'>):{thread_id:string;revision:number;total:number;item_count:number;items:readonly HistoryItem[]}{
 if(items.length!==total||items.some((item,index)=>!item.node_id||item.selection?.ordinal!==index))throw new Error('Incomplete declared fixture path');
 const before=args.before??0,after=args.after??0;
 if(!Number.isSafeInteger(before)||!Number.isSafeInteger(after)||before<0||after<0||before+after+1>200)throw new Error('Invalid selected fixture bounds');
 const anchor=args.ordinal??(args.node_id===undefined?Math.max(0,total-1):items.findIndex(item=>item.node_id===args.node_id));
 if(anchor<0||anchor>=total)throw new Error('Missing declared fixture anchor');
 if(args.node_id!==undefined&&items[anchor]?.node_id!==args.node_id)throw new Error('Mismatched declared fixture anchor');
 const selected=items.slice(Math.max(0,anchor-before),Math.min(total,anchor+after+1));
 return{thread_id:threadId,revision,total,item_count:selected.length,items:selected};
}
