import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { composerAction } from "../../../../../ui-core/src";
import { Icon } from "../Icon";
import { Button } from "../Button";

export function Composer(props: { label: string; placeholder: string; hint: string; sendLabel: string; canSend: boolean; busy: boolean; draftStatus?: (text:string)=>{blocked:boolean;hint:string}; draftScope?: string; stop?: ComponentChildren; onSend: (text: string, onReserved?: () => void) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const draft = useRef("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const generation = useRef(0);
  const updateDraft = (value: string) => {
    if (draft.current !== value) { draft.current = value; generation.current++; }
    setText(value);
  };
  const latestScope = useRef(props.draftScope);
  const scopeGeneration = useRef(0);
  if (latestScope.current !== props.draftScope) { latestScope.current = props.draftScope; scopeGeneration.current++; }
  const status=props.draftStatus?.(text);
  const submitting = useRef(false);
  const submit = async () => {
    if (submitting.current || !props.canSend || props.draftStatus?.(draft.current).blocked || props.busy || draft.current.trim() === "") return;
    const submittedGeneration = generation.current;
    const submittedScope = props.draftScope;
    const submittedScopeGeneration = scopeGeneration.current;
    const submittedText = draft.current;
    const clearOriginal = () => {
      if (generation.current !== submittedGeneration || latestScope.current !== submittedScope || scopeGeneration.current !== submittedScopeGeneration) return;
      generation.current++; draft.current = "";
      if (textarea.current) textarea.current.value = "";
      setText("");
    };
    submitting.current = true;
    let notifying = true, reserved = false;
    try {
      const result = props.onSend(submittedText, () => {
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
    <div class="composer">
      <textarea
        ref={textarea}
        id="composer"
        aria-label={props.label}
        placeholder={props.placeholder}
        value={text}
        onInput={(e) => updateDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (composerAction(e) === "send") {
            e.preventDefault();
            if (!props.canSend || props.busy || submitting.current) return;
            void submit();
          }
        }}
      />
      <div class="row">
        <span class="hint" role="status">{status?.hint??props.hint}</span>
        <div class="right">
          {props.stop}
          <Button icon label={props.sendLabel} variant="primary" disabled={!props.canSend || status?.blocked || props.busy || text.trim() === ""} onClick={() => void submit()}>
            <Icon name="send" />
          </Button>
        </div>
      </div>
    </div>
  );
}
