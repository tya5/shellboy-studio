export function LogBlock({ text, boxed }: { text: string; boxed?: boolean }) {
  return <pre class={boxed ? "log boxed" : "log"} tabIndex={0}>{text}</pre>;
}
