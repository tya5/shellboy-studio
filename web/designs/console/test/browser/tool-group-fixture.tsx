import { render } from 'preact';
import { StepRow, StatusMark } from '../../system/components';
import '../../system/tokens/console.css';
import '../../system/tokens/light.css';
import '../../system/components.css';
import '../../system/layout.css';
const status = <StatusMark status="completed" label="Completed" />;
const tool = (command: string, open = false) => <StepRow open={open} command={command} status={status} duration="1.2s" onToggle={() => {}}><pre class="log">{`$ ${command}\n3 files checked\nDone`}</pre></StepRow>;
function group(title: string, children: preact.ComponentChildren) {
  return <StepRow open command={title} group status={status} onToggle={() => {}}><div class="step-group-list">{children}</div></StepRow>;
}
render(<main style="display:flex;flex-direction:column;gap:var(--space-16);max-width:760px;margin:var(--space-16) auto;padding:0 var(--space-12)">
  <h2>Single tool</h2>{group('1 tool', tool('git status'))}
  <h2>Multiple tools</h2>{group('3 tools', [tool('git status'), tool('npm run check'), tool('git diff --check')])}
  <h2>Expanded output</h2>{group('2 tools', [tool('npm run check', true), tool('git status')])}
  <h2>Standalone tool</h2>{tool('git log -1', true)}
</main>, document.getElementById('app')!);
