import {SavedWindowContent} from '../screens/Conversation';
import {fixtureConversation} from '../../../ui-core/test/fixture';
import {settle} from '../../../data/test/harness';
import type {HistoryItem,WorkItem} from '../../../data/src/protocol';

type PublicConversationInput={readonly nodes:readonly HistoryItem[];readonly work?:readonly WorkItem[];readonly revision?:number};
/** Public owner inputs enter the real model once; no projection or display-plan fixture authority. */
export async function publicConversationFixture(input:PublicConversationInput){
 const fixture=await fixtureConversation(input);
 const publish=async(next:PublicConversationInput)=>{
  const reader=fixture.model.longReader.peek();if(!reader)throw new Error('fixture has no current conversation reader');
  fixture.db.history.lead=[...next.nodes];fixture.db.work.lead=(next.work??[]).map(item=>({...item}));
  fixture.db.historyRevisions.lead=(reader.acceptedView.peek().revision??0)+1;
  reader.changed();await settle(fixture.t,fixture.db);
  const current=reader.acceptedView.peek();
  if(current.revision!==fixture.db.historyRevisions.lead)throw new Error(`public fixture successor not committed: expected=${fixture.db.historyRevisions.lead} current=${current.revision} rows=${JSON.stringify(current.rows.map(row=>row.node_id))} reads=${JSON.stringify(fixture.t.calls('history.window').map(call=>({args:call.args,answered:fixture.db.answered.has(call.id)})))}`);
 };
 return{...fixture,publish};
}
export function CurrentSavedView({fixture}:{fixture:Awaited<ReturnType<typeof publicConversationFixture>>}){
 const reader=fixture.model.longReader.value;
 if(!reader)return null;
 const snapshot=reader.acceptedView.current;
 return <section data-fixture-accepted-generation={snapshot.generation}><SavedWindowContent model={fixture.model} snapshot={snapshot}/></section>;
}
