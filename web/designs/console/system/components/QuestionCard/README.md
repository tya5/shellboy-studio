# QuestionCard

- **Use for:** Present one pending model question with the Thread and its answer or withdrawal controls where available.
- **Do not use for:** Use QuestionItem for a compact list entry and Composer for a new message.
- **Why:** A separate card keeps the exact question and reply actions together; the caller can disable submission while busy.
- **Source:** 出典なし（この Studio で決めた）

A question from a model that waits for the person, with the answer box.

Provide the question, the Thread and the answer and withdraw actions. Place it above the composer in a conversation and at the top of the phone list. Keep one card per question.

Today this renders from test fixtures only: `message ask` (Shellboy #262) isn't on main. There is no withdraw action until the owner defines one.

Styles are colocated in `system/components/QuestionCard/style.css`.

Styles: style.css in this directory

A caller-owned in-flight operation can disable answer submission through `busy`.
