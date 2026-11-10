import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { composerAction } from "../../../../../ui-core/src";
import { Icon } from "../Icon";
import { Button } from "../Button";

export function Composer(props: { label: string; placeholder: string; hint: string; sendLabel: string; canSend: boolean; busy: boolean; stop?: ComponentChildren; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const generation = useRef(0);
  const submitting = useRef(false);
  const submit = async () => {
    if (submitting.current || !props.canSend || props.busy || text.trim() === "") return;
    const submittedGeneration = generation.current;
    submitting.current = true;
    try { if (await props.onSend(text) && generation.current === submittedGeneration) { generation.current++; setText(""); } }
    finally { submitting.current = false; }
  };
  return (
    <div class="composer">
      <textarea
        id="composer"
        aria-label={props.label}
        placeholder={props.placeholder}
        value={text}
        onInput={(e) => { generation.current++; setText(e.currentTarget.value); }}
        onKeyDown={(e) => {
          if (composerAction(e) === "send") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div class="row">
        <span class="hint">{props.hint}</span>
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
