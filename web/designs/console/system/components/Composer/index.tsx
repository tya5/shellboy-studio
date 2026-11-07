import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { composerAction } from "../../../../../ui-core/src";
import { Icon } from "../Icon";
import { Button } from "../Button";

export function Composer(props: { label: string; placeholder: string; hint: string; sendLabel: string; canSend: boolean; busy: boolean; stop?: ComponentChildren; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const submit = async () => {
    if (!props.canSend || props.busy || text.trim() === "") return;
    if (await props.onSend(text)) setText("");
  };
  return (
    <div class="composer">
      <textarea
        id="composer"
        aria-label={props.label}
        placeholder={props.placeholder}
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
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
