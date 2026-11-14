import type {DeclaredPlanCut} from './publication-contract';
import type {TerminalPresence} from '../src/terminal-presence';
import type {WorkGroup} from '../src/conversation-items';
export function declaredWorkGroup(input:{members:readonly string[];tools:readonly string[];executions:readonly string[];
 counts:{Tools:number;Reasoning:number;Notifications:number;Problems:number};before:'closed'|'unknown';after:'closed'|'unknown'}):WorkGroup{
 const first=input.members[0]!;
 return{key:JSON.stringify(['work',input.tools[0]??first]),firstMemberKey:first,anchorKey:first,memberKeys:input.members,
  executionIds:input.executions,toolItemKeys:input.tools,unknownToolCount:0,interrupted:false,categoryCounts:input.counts,
  continuationBefore:input.before,continuationAfter:input.after};
}
export function declaredToolAnswerCut(input:{scope:string;revision:number;toolIdentity:'call'|'tc';
 answer?:'saved'|'partial'|'deferred'|'opaque';container?:string;presence?:TerminalPresence}):DeclaredPlanCut{
 const {scope,revision}=input;
 const tool=JSON.stringify(['tool',[scope],'execution',['exec']]),answer=JSON.stringify(['answer','text']);
 const receipt=JSON.stringify(['receipt','work',scope,'attempt']);
 const entries:DeclaredPlanCut['entries'][number][]=[{key:tool,canonicalKey:JSON.stringify(['tool',input.toolIdentity]),toolIdentity:'execution',case:'toolCall',
  source:{nodeId:'tool',itemIdentity:input.toolIdentity,windowRevision:revision,keyScope:[scope],classificationCase:'toolCall',kind:'tool',executionIds:['exec']},
  body:{kind:'unavailable',reason:'tool'},lifetime:'retained'}];
 if(input.answer==='saved'||input.answer==='partial')entries.push({key:answer,case:'assistantText',
  source:{nodeId:'answer',itemIdentity:'text',windowRevision:revision,keyScope:[scope],classificationCase:'assistantText',kind:'text',
   text:input.answer==='saved'?'saved':'prefix',textComplete:input.answer==='saved'},
  body:input.answer==='saved'?{kind:'typed-canonical',text:'saved'}:{kind:'unavailable',reason:'text'},
  lifetime:input.container?'valid-owner':'retained',container:input.container});
 const unavailable= input.answer==='deferred'?JSON.stringify(['node','answer']):JSON.stringify(['answer','missing']);
 if(input.answer==='deferred'||input.answer==='opaque')entries.push({key:unavailable,case:'unavailable',
  source:input.answer==='deferred'?{nodeId:'answer',itemIdentity:'answer',identityDomain:'node',windowRevision:revision,keyScope:[scope],classificationCase:'unavailable',kind:'unavailable',reason:'response_budget'}:
   {nodeId:'answer',itemIdentity:'missing',windowRevision:revision,keyScope:[scope],classificationCase:'unavailable',kind:'unavailable',reason:'opaque'},
  body:{kind:'unavailable',reason:'unavailable'},lifetime:'retained'});
 if(input.presence){const phase=input.presence.phase;const name=phase==='pending'?'terminalPending':phase==='reading'?'terminalReading':'terminalSettled';
  entries.push({key:receipt,case:name,source:{domain:'receipt',scope,recordId:'attempt',attemptId:'attempt',namespace:'work',keyScope:[scope],classificationCase:name,
   terminalPresence:input.presence,kind:'record'},body:{kind:'unavailable',reason:'record'},lifetime:'retained'});}
 const conversation=input.answer==='saved'||input.answer==='partial';
 const firstMembers=[tool,...(!conversation&&input.answer?[unavailable]:[]),...(!conversation&&input.presence?[receipt]:[])];
 const first=declaredWorkGroup({members:firstMembers,tools:[tool],executions:['exec'],
  counts:{Tools:1,Reasoning:0,Notifications:!conversation&&input.presence&&input.presence.phase!=='settled'?1:0,Problems:(!conversation&&input.answer?1:0)+(!conversation&&input.presence?.phase==='settled'?1:0)},before:'unknown',after:conversation?'closed':'unknown'});
 const groups=[first];
 const sequence:DeclaredPlanCut['sequence'][number][]=[{kind:'work',groupKey:first.key}];
 if(conversation){sequence.push({kind:'conversation',itemKey:answer});if(input.presence){
  const last=declaredWorkGroup({members:[receipt],tools:[],executions:[],counts:{Tools:0,Reasoning:0,Notifications:input.presence.phase==='settled'?0:1,Problems:input.presence.phase==='settled'?1:0},before:'closed',after:'unknown'});
  groups.push(last);sequence.push({kind:'work',groupKey:last.key});}}
 return{revision,scope,coverage:'complete',rows:input.answer?['tool','answer']:['tool'],entries,sequence,groups,
  unknownKeys:input.answer==='deferred'||input.answer==='opaque'?[unavailable]:[]};
}
