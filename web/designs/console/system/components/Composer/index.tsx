import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { composerAction } from "../../../../../ui-core/src";
import { Icon } from "../Icon";
import { Button } from "../Button";

export function Composer(props: { label: string; placeholder: string; hint: string; sendLabel: string; canSend: boolean; busy: boolean; stop?: ComponentChildren; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const draft = useRef("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const generation = useRef(0);
  const updateDraft = (value: string) => {
    if (draft.current !== value) { draft.current = value; generation.current++; }
    setText(value);
  };
  const submitting = useRef(false);
  const submit = async () => {
    if (submitting.current || !props.canSend || props.busy || draft.current.trim() === "") return;
    const submittedGeneration = generation.current;
    submitting.current = true;
    try { if (await props.onSend(draft.current) && generation.current === submittedGeneration) { generation.current++; draft.current = ""; if (textarea.current) textarea.current.value = ""; setText(""); } }
    finally { submitting.current = false; }
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
        <span class="hint" role="status">{props.hint}</span>
        <div class="right">
          {props.stop}
          <Button icon label={props.sendLabel} variant="primary" disabled={!props.canSend || props.busy || text.trim() === ""} onClick={() => void submit()}>
            <Icon name="send" />
          </Button>
        </div>
      </div>
    </div>
  );
}
