// @vitest-environment happy-dom
import { render } from 'preact';
import { expect, it } from 'vitest';
import { WorkElementRow, formatWorkElementDisplay } from '../system/components/WorkElementRow';
import type { WorkElementDisplay } from '../../../ui-core/src/work-element-display';

const base: WorkElementDisplay = {
 typeIcon:'cube', typeAccessibleLabel:'Tool', contentLabel: {text:'actual command',context:[]},
 state:null, detailPolicy:'none',
};
for (const [status, css, mark] of [
 ['completed','ok','check'], ['failed','fail','cross'], ['running','run',null], ['stopped','halt',null],
] as const) it(`inner tool row consumes issued ${status} through existing StatusMark`, () => {
 const host=document.createElement('div');
 const source: WorkElementDisplay={...base,state:{source:'wire',value:'exact machine state',executionStatus:status,exitCode:status==='completed'?0:1}};
 const display=formatWorkElementDisplay(source);
 expect(display.source).toBe(source);
 render(<WorkElementRow display={display} anchorKey="row" detailPolicy="none"/>,host);
 expect(host.querySelector(`.work-element-row__state .st.${css}`)).not.toBeNull();
 expect(host.textContent).toContain('exact machine state');
 expect(host.querySelector('.work-element-row')?.getAttribute('data-exit-code')).toBe(String(source.state?.exitCode));
 if(mark) expect(host.querySelector('.st svg')).not.toBeNull();
 else expect(host.querySelector('.st .dot')).not.toBeNull();
 render(null,host);
});
for (const origin of ['wire','client'] as const) it(`untyped ${origin} state never becomes a success mark`,()=>{
 const host=document.createElement('div');
 render(<WorkElementRow display={formatWorkElementDisplay({...base,state:{source:origin,value:'completed'}})} anchorKey="row" detailPolicy="none"/>,host);
 expect(host.querySelector('.st')).toBeNull();
 expect(host.textContent).toContain(origin==='client'?'CLIENT completed':'completed');
 render(null,host);
});
