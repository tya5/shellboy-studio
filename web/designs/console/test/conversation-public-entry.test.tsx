// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { expect, it } from 'vitest';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { projectSavedItems } from '../../../ui-core/src/conversation-items';

it('provides a Console-owned saved-text renderer without a fixture render callback',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const screen=await import('../screens/Conversation') as unknown as Record<string,any>;
    expect(screen.SavedConversationItems).toBeTypeOf('function');
    const Saved=screen.SavedConversationItems;
    const projection=projectSavedItems([{nodeId:'synthetic-saved-node',itemIdentity:'text-0',revision:'synthetic-r1',kind:'text',text:'Synthetic saved text without registry callback'}]);
    await act(async()=>render(<Saved model={fixture.model} projection={projection}/>,host));
    expect(host.textContent).toContain('Synthetic saved text without registry callback');
    expect(host.querySelector('[data-item-key]')?.getAttribute('data-node')).toBe('synthetic-saved-node');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});
