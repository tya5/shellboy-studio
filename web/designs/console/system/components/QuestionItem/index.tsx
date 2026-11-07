export function QuestionItem({ title, age, question, current, onClick }: { title: string; age?: string | undefined; question: string; current: boolean; onClick: () => void }) {
  return (
    <button type="button" class="qitem" aria-current={current ? "true" : undefined} onClick={onClick}>
      <small>
        <b>{title}</b>
        {age ? <span class="mono">{age}</span> : null}
      </small>
      <span>{question}</span>
    </button>
  );
}
