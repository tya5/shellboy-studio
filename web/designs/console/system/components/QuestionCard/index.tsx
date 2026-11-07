import { useState } from "preact/hooks";
import { StatusMark } from "../StatusMark";
import { Button } from "../Button";

export function QuestionCard(props: { id: string; label: string; waitingWord: string; question: string; answerLabel: string; submitLabel: string; error?: string | undefined; onAnswer: (text: string) => void; extra?: preact.ComponentChildren }) {
  const [text, setText] = useState("");
  return (
    <section class="q">
      <div class="lab">
        <StatusMark status="awaiting" label={props.waitingWord} word={false} />
        {props.label}
      </div>
      <div class="t">{props.question}</div>
      <label for={`answer-${props.id}`}>{props.answerLabel}</label>
      <textarea id={`answer-${props.id}`} value={text} onInput={(e) => setText(e.currentTarget.value)} />
      {props.error ? <div role="alert">{props.error}</div> : null}
      <div class="acts">
        {props.extra}
        <Button variant="primary" disabled={text.trim() === ""} onClick={() => props.onAnswer(text)}>
          {props.submitLabel}
        </Button>
      </div>
    </section>
  );
}
