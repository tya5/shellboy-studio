import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { composerAction } from "../../../../../ui-core/src";
import { Icon } from "../Icon";
import { Button } from "../Button";

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
      {props.routing && (props.routing.shells.length > 0 || props.routing.turnRunning || unavailableTarget) ? <div class="composer-above"><ComposerRouting {...props.routing} target={draft.target} unavailableTarget={unavailableTarget ? props.routing.unavailableTarget : undefined} timingDisabled={selectedShell !== undefined || !props.routing?.turnRunning} eof={selectedShell && props.routing.onEof ? { label: props.routing.eofLabel(selectedShell.command), run: () => props.routing!.onEof!(selectedShell.id, selectedShell.command) } : undefined} onTarget={setDraftTarget} /></div> : props.above ? <div class="composer-above">{props.above}</div> : null}
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


export function ComposerRouting(props: { label: string; modelLabel: string; target: string; shells: readonly { id: string; command: string }[]; onTarget: (id: string) => void; unavailableTarget?: string; eof?: { label: string; run: () => void }; timingLabel: string; timing: "next" | "now"; onTiming: (timing: "next" | "now") => void; timingDisabled?: boolean; turnRunning?: boolean; nextLabel: string; nowLabel: string; nextExplanation: string; nowExplanation: string }) {
  const selectedShell = props.shells.find(shell => shell.id === props.target);
  const targetLabel = selectedShell?.command ?? props.unavailableTarget ?? props.modelLabel;
  return <div class="composer-routing">
    {props.shells.length > 0 || props.unavailableTarget ? <div class="composer-control" role="group" aria-label={props.label}>
      <Button variant="ghost" class="composer-choice" aria-pressed={props.target === "model"} aria-label={`${props.modelLabel}. ${props.label}`} title={props.modelLabel} onClick={() => props.onTarget("model")}>{props.modelLabel}</Button>
      {props.shells[0] ? <Button variant="ghost" class="composer-choice" aria-pressed={props.target === props.shells[0].id} aria-label={`${props.shells[0].command}. ${props.label}`} title={props.shells[0].command} onClick={() => props.onTarget(props.shells[0]!.id)}>{props.shells[0].command}</Button>
        : props.unavailableTarget ? <Button variant="ghost" class="composer-choice" aria-pressed="true" aria-label={props.unavailableTarget} title={props.unavailableTarget} disabled>{props.unavailableTarget}</Button> : null}
      {props.eof && selectedShell ? <Button variant="ghost" icon label={props.eof.label} title={props.eof.label} onClick={props.eof.run}><Icon role="action.shellEof" size="small" /></Button> : null}
    </div> : null}
    {props.turnRunning ? <div class="composer-control composer-timing-control" role="group" aria-label={props.timingLabel}>
      <Button variant="ghost" class="composer-choice" disabled={props.timingDisabled} aria-pressed={props.timing === "next"} aria-label={`${props.nextLabel}. ${props.nextExplanation}`} title={props.nextExplanation} onClick={() => props.onTiming("next")}>{props.nextLabel}</Button>
      <Button variant="ghost" class="composer-choice" disabled={props.timingDisabled} aria-pressed={props.timing === "now"} aria-label={`${props.nowLabel}. ${props.nowExplanation}`} title={props.nowExplanation} onClick={() => props.onTiming("now")}>{props.nowLabel}</Button>
      <span class="composer-timing-hint">{props.timing === "now" ? props.nowExplanation : props.nextExplanation}</span>
    </div> : null}
  </div>;
}
