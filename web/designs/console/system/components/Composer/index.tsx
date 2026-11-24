import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { composerAction } from "../../../../../ui-core/src";
import { Icon } from "../Icon";
import { Button } from "../Button";
import { ButtonGroup } from "../ButtonGroup";

export function Composer(props: { label: string; placeholder: string; hint: string; sendLabel: string; canSend: boolean | ((target: string) => boolean); busy: boolean; allowWhitespace?: boolean | ((target: string) => boolean); above?: ComponentChildren; routing?: Omit<Parameters<typeof ComposerRouting>[0], "target" | "onTarget" | "timingDisabled" | "eof"> & { onEof?: (executionId: string, command: string) => void; eofLabel: (command: string) => string }; interrupt?: { label: string; run: () => void }; draftStatus?: (text:string,target:string)=>{blocked:boolean;hint:string}; draftScope?: string;  start?: ComponentChildren; context?: ComponentChildren; stop?: { label: string; run: () => void }; onSend: (text: string, target: string, onReserved?: () => void) => Promise<boolean> }) {
  const [, renderDraft] = useState(0);
  const drafts = useRef(new Map<string | undefined, { text: string; target: string }>());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const removingFocusedStop = !props.stop && stopButton.current
    && stopButton.current.ownerDocument.activeElement === stopButton.current;
  useLayoutEffect(() => {
    const field = textarea.current;
    if (removingFocusedStop && field && field.ownerDocument.activeElement === field.ownerDocument.body) field.focus();
  });
  const generation = useRef(0);
  const latestScope = useRef(props.draftScope);
  if (latestScope.current !== props.draftScope) latestScope.current = props.draftScope;
  const draft = drafts.current.get(props.draftScope) ?? { text: "", target: "model" };
  const text = draft.text;
  const updateDraft = (value: string) => {
    const scope = props.draftScope;
    const current = drafts.current.get(scope) ?? { text: "", target: "model" };
    if (current.text === value) return;
    drafts.current.delete(scope);
    if (value !== "" || current.target !== "model") drafts.current.set(scope, { ...current, text: value });
    if (drafts.current.size > 16) drafts.current.delete(drafts.current.keys().next().value);
    renderDraft(++generation.current);
  };
  const setDraftTarget = (target: string) => {
    const scope = props.draftScope;
    const current = drafts.current.get(scope) ?? { text: "", target: "model" };
    drafts.current.delete(scope);
    if (current.text !== "" || target !== "model") drafts.current.set(scope, { ...current, target });
    if (drafts.current.size > 16) drafts.current.delete(drafts.current.keys().next().value);
    renderDraft(++generation.current);
  };
  const selectedShell = props.routing?.shells.find(shell => shell.id === draft.target);
  const unavailableTarget = draft.target !== "model" && !selectedShell;
  const status=props.draftStatus?.(text, draft.target);
  const canSend = typeof props.canSend === "function" ? props.canSend(draft.target) : props.canSend;
  const allowWhitespace = typeof props.allowWhitespace === "function" ? props.allowWhitespace(draft.target) : props.allowWhitespace;
  const hasContent = text.length > 0 && (allowWhitespace === true || text.trim() !== "");
  const submitting = useRef(false);
  const submit = async () => {
    const submittedScope = props.draftScope;
    const submittedDraft = drafts.current.get(submittedScope) ?? { text: "", target: "model" };
    const submittedText = submittedDraft.text;
    const submittedTarget = submittedDraft.target;
    const submittedCanSend = typeof props.canSend === "function" ? props.canSend(submittedTarget) : props.canSend;
    const submittedAllowWhitespace = typeof props.allowWhitespace === "function" ? props.allowWhitespace(submittedTarget) : props.allowWhitespace;
    if (submitting.current || !submittedCanSend || props.draftStatus?.(submittedText, submittedTarget).blocked || props.busy || submittedText.length === 0 || (!submittedAllowWhitespace && submittedText.trim() === "")) return;
    const clearOriginal = () => {
      if (drafts.current.get(submittedScope) !== submittedDraft) return;
      drafts.current.delete(submittedScope);
      renderDraft(++generation.current);
      if (latestScope.current === submittedScope && textarea.current) textarea.current.value = "";
    };
    submitting.current = true;
    let notifying = true, reserved = false;
    try {
      const result = props.onSend(submittedText, submittedTarget, () => {
        // The owner may transfer this draft only during this submission call.
        if (!notifying || reserved) return;
        reserved = true;
        clearOriginal();
      });
      notifying = false;
      if (await result) clearOriginal();
    }
    finally { notifying = false; submitting.current = false; }
  };
  return (
    <div class="composer-root">
      {props.routing ? <div class="composer-above"><ComposerRouting {...props.routing} target={draft.target} unavailableTarget={unavailableTarget ? props.routing.unavailableTarget : undefined} timingDisabled={selectedShell !== undefined} eof={selectedShell && props.routing.onEof ? { label: props.routing.eofLabel(selectedShell.command), run: () => props.routing!.onEof!(selectedShell.id, selectedShell.command) } : undefined} onTarget={setDraftTarget} /></div> : props.above ? <div class="composer-above">{props.above}</div> : null}
      <textarea
        ref={textarea}
        id="composer"
        aria-label={props.label}
        placeholder={props.placeholder}
        rows={2}
        value={text}
        onInput={(e) => updateDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (composerAction(e) === "send") {
            e.preventDefault();
            const canSend = typeof props.canSend === "function" ? props.canSend(draft.target) : props.canSend;
            if (!canSend || props.busy || submitting.current) return;
            void submit();
          }
        }}
      />
      <div class="composer-row">
        {props.start}
        <span class="composer-hint" role="status">{status?.hint??props.hint}</span>
        <div class="right">
          {props.context}
          {props.interrupt ? <Button icon label={props.interrupt.label} variant="ghost" onClick={props.interrupt.run}><Icon role="action.interruptTurn" size="small" /></Button> : null}
          {props.stop ? <Button buttonRef={stopButton} icon label={props.stop.label} title={props.stop.label} variant="stop" onClick={props.stop.run}>
            <Icon role="action.stop" size="small" />
          </Button> : null}
          <Button icon label={props.sendLabel} variant="primary" disabled={!canSend || status?.blocked || props.busy || !hasContent} onClick={() => void submit()}>
            <Icon role="composer.send" />
          </Button>
        </div>
      </div>
    </div>
  );
}


export function ComposerRouting(props: { label: string; modelLabel: string; target: string; shells: readonly { id: string; command: string }[]; onTarget: (id: string) => void; unavailableTarget?: string; eof?: { label: string; run: () => void }; timingLabel: string; timing: "next" | "now"; onTiming: (timing: "next" | "now") => void; timingDisabled?: boolean; nextLabel: string; nowLabel: string; nextExplanation: string; nowExplanation: string }) {
  return <div class="composer-routing">
    <div class="composer-target-chip"><label>{props.label} <select aria-label={props.label} value={props.target} onChange={event => props.onTarget(event.currentTarget.value)}>
      <option value="model">{props.modelLabel}</option>{props.unavailableTarget ? <option value={props.target}>{props.unavailableTarget}</option> : null}{props.shells.map(shell => <option value={shell.id} key={shell.id}>{shell.command}</option>)}
    </select></label>{props.eof ? <Button variant="ghost" icon label={props.eof.label} onClick={props.eof.run}><Icon role="action.shellEof" size="small" /></Button> : null}</div>
    <div class="composer-timing"><span>{props.timingLabel}</span><ButtonGroup label={props.timingLabel}>
      <Button variant="ghost" aria-pressed={props.timing === "next"} disabled={props.timingDisabled} onClick={() => props.onTiming("next")}>{props.nextLabel}</Button>
      <Button variant="ghost" aria-pressed={props.timing === "now"} disabled={props.timingDisabled} onClick={() => props.onTiming("now")}>{props.nowLabel}</Button>
    </ButtonGroup><p class="composer-timing-explanation">{props.timing === "now" ? props.nowExplanation : props.nextExplanation}</p></div>
  </div>;
}
