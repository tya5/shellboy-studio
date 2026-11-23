# Core v0.15.0 + Studio v0.4.0 リリースノート

Studio 0.4.0 は、commit `318abee0609eeb3b15a3a21b74b85f816c7d3ea0` の
Shellboy Core v0.15.0（protocol 18）と組み合わせて使用します。この正確な組み合わせを
導入してください。これより古い Core はサポート対象外です。

Studio の Thread 一覧と会話画面を見直し、Thread の状態や返信が必要な項目を追いやすくしました。Core v0.15.0 は公開済みです。Studio v0.4.0 は準備中で、**未取り込み**と記した項目は収録済みではありません。

比較範囲：[Studio v0.3.0 (`d32de25`) → `origin/main` (`ced0503`)](https://github.com/tya5/shellboy-studio/compare/v0.3.0..ced0503cb53f8bcc5094528eb5b2b3d1f26d6ccc) ／ Core v0.14.0 (`b644b3c`) → v0.15.0 (`318abee`)。特記のない Issue 番号は Studio のものです。

## Thread 一覧と状態表示

- ふだんは変更された Thread の行だけを読み直します。Core が Studio より後に起動したときや再接続時は、一覧と会話を読み直します（#96、#99）。
- 一覧の読み込み範囲より古いピン留めも表示し、全件が分からない件数は下限と分かる形で示します。一覧の外にあるピン留めにもモニターで状態の印が付き、設定画面にも共通のフッターを一つだけ表示します（#106、#110）。
- 最後の Run が失敗した古い Thread や復旧待ちの Thread も、初回表示時に現在の状態をもとに件数とモニターに反映します（#102、Core #378）。
- 「動作」の更新中も保留中の行と件数を残し、空表示のちらつきを抑えます（#108）。
- **未取り込み・公開条件：** 開いている Thread が検索結果や読み込み範囲の外でも、その Thread 自身の情報から状態・エラー・再試行を表示し、エラー通知を一か所にまとめる修正（#103、#107）。

## 全画面のデザインシステム v2

会話、サイドバー、Threads、Branches、Monitor、Inbox、Analytics、設定、初期設定、Apps で、見出し、ボタンの優先度、リンク、余白、読み込み中・空の表示をそろえました。移動するリンクと、その場で操作するボタンを見分けやすくしています（#97 と各画面への適用）。

## 会話の右パネル

- Thread の成果物（Artifact）を一覧し、対応する形式をプレビューしたり、過去の版を選んで開いたりできます。版は参照先の記録で、ファイルのコピーではありません（#35、Core #316）。
- 要返信・返信待ちの一覧は、添付や成果物と同様に、読み足した範囲を更新し、一時的な読み取りエラーでも表示済みの行を残して再試行できます（#77）。
- 幅 900〜1179 px でも右パネルを開けます。古い「会話の作業」シートを廃止し、返信・配信状態の詳しい表示を読みやすくしました（#104）。幅 1180 px 未満でも「動作」の行から詳細を開けます。`Alt+9` は幅にかかわらず右パネルを開閉します（#113）。

## 会話

- 入力途中の文章は Thread ごとに保持します。Thread を切り替えても書きかけが別の Thread に移らず、戻れば入力を続けられます（#109）。
- Core は、出力上限に達した会話応答でも、得られたテキストや拒否応答を保存して Turn を完了できます。途切れたツール呼び出しは実行せず、自動で再試行もしません（Core #354、#355）。
- 過去の会話を読んでいるときは、履歴の追加読み込みや、後から本文全体が届いたときにも、読んでいた位置を保ちます（#6）。
- Branches では分岐位置と各分岐の結論を確認でき、比較時には該当箇所の抜粋を表示します（#1）。

## 設定の共有と Inbox

- 共有できる設定を TOML に書き出し、初期設定または設定画面で読み込めます。同名の接続の上書きや既定値の変更を適用前に確認できます。API キーや端末固有のパスは共有せず、必要なキーは各自で登録します（#41）。
- ガイド登録の保存に失敗しても入力パスを残し、接続テストでは失敗の種類を表示します。モデル選択では開いたときに検索欄にフォーカスし、Esc で設定画面に留まります。分析のトークンピークは欠測と下限を区別し、右パネルの「情報」は読み込み中・失敗・空を区別します。Studio の表示言語は Core の TUI・CLI 言語設定とは別です（#114）。
- Inbox の「あなた待ち」は「さらに表示」で前の質問を残し、更新通知でも先頭ページに戻ったり回答の書きかけを消したりしません。バッジは読み込み済みの行数ではなく全体の件数を示します（上限に達した場合は `128+`、#105）。

## デスクトップ版と安定性

- Studio のリリース用ワークフローは、CLI 版に加え macOS の `.app` を含む ZIP と Windows x64 の起動役・Core を含む ZIP を作り、`SHA256SUMS` に含めます。署名・公証や自動更新は今回の対象外です（#98）。
- 共通の `extra_instructions` に読めないファイルがあっても、新しい Turn を止めず、そのファイルだけ読み飛ばします。パスと理由は `status` と `thread get` で確認できます（Core #377）。Studio の開発・テストでは、普段使っている Core の設定やデータに触れないよう接続先を分離しました（#101）。
- Core CLI は、保持されている会話履歴をチェックサム付き JSONL に書き出し、検証済みのファイルを新しい Thread として読み込めます。書き出しは固定スナップショットではなく、読み込みで Run や Turn は復元しません。書き出しファイルには保存済みの推論データが含まれる場合があります（Core #344、#345）。

## アップグレード

1. Core と Studio を終了し、移行前の **Core データディレクトリ全体**をバックアップしてください。設定ファイルを別の場所に置いている場合は、それも別途保存してください。
2. **Core v0.15.0 と Studio v0.4.0 をセットで差し替えてください。** IPC プロトコルは **11 → 18** で、完全一致が必要です。Core だけ先に同じデータで起動すると、古い Studio は接続できなくなります。
3. Core の起動時に DB スキーマが **56 → 62** に進みます。57：出力上限の記録、58：読み込んだ履歴の出所、59：成果物と版、60：操作受付の区分（既存は `normal`）、61：スケジュール表の再構築と索引の作り直し、62：指示ファイルの警告。61 は既存のスケジュール行をコピーするので、件数に応じた処理が発生します。所要時間は未計測です。自動ダウングレードはありません。旧版に戻すときは移行前のバックアップを復元してください。
4. **設定キー：** タグ間で削除・改名された TOML キーは確認されていません。`connections.<name>.models.include` / `.exclude` が追加されました（Core #319）。大文字・小文字を区別する `*` / `?` でモデル一覧だけを絞り込み、モデル ID の直接指定は引き続き可能です。`extra_instructions` の書式は同じです。ファイルのハッシュを確認する `config set` で、ファイルを書き直さずに、ディスクにある正しい値を起動中の Core に反映できるようになりました（Core #377）。
5. **CLI：** タグ間で削除・改名されたコマンドやフラグは確認されていません。旧ドキュメントの `message send --expect-reply` は v0.14.0 にもないため、`message ask` を使ってください。モデルは自分の Thread に `message ask` できず、`message reply` は受け取った返信義務に限られます。人に聞くなら `--thread` を省略し、自分の依頼を取り下げるなら `message cancel` を使います（Core #370、#374）。

## 検証済み／未検証

- **検証済み（CI のみ）：** Core v0.15.0 の [Rust checks](https://github.com/tya5/shellboy/actions/runs/45258958394) と [Release binaries](https://github.com/tya5/shellboy/actions/runs/45259022310)。比較先の Studio `ced0503` は [Checks](https://github.com/tya5/shellboy-studio/actions/runs/45275011488) で macOS・Windows・Linux のチェックと、固定した Core との組み合わせテストを通過しました。
- **未検証：** [公開条件 #111](https://github.com/tya5/shellboy-studio/issues/111) の #103（#107 を含む）の取り込みは未完了です。最終ペアの候補 CI と端末確認も未実施です。Mac 実機での APFS コピーを使った移行、差し替え後の状態表示、配布 ZIP からの起動は未確認です。**Windows 実機は未確認です。** 根拠：[Core の更新差分メモ](https://github.com/tya5/shellboy-studio/issues/111#issuecomment-7113603358)。

---

# Core v0.15.0 + Studio v0.4.0 release notes

Studio 0.4.0 is paired with Shellboy Core v0.15.0 at commit
`318abee0609eeb3b15a3a21b74b85f816c7d3ea0`, using protocol 18. Install this
exact pair; older Core versions are not a supported pairing.

Studio makes it easier to see what your Threads are doing and what needs a reply. Core v0.15.0 is published; Studio v0.4.0 is still in preparation. Items marked **not landed** are not yet included.

Compared: [Studio v0.3.0 (`d32de25`) → `origin/main` (`ced0503`)](https://github.com/tya5/shellboy-studio/compare/v0.3.0..ced0503cb53f8bcc5094528eb5b2b3d1f26d6ccc); Core v0.14.0 (`b644b3c`) → v0.15.0 (`318abee`). Issue numbers refer to Studio unless marked Core.

## Thread list and status

- Studio normally refreshes only the Threads that changed. When Core starts after Studio or Studio reconnects, it reloads the list and conversation (#96, #99).
- Older pins appear even when they are outside the loaded pages. Counts that are only lower bounds are shown as such. Monitor displays status for pins outside the list, and Settings shares a single status footer with the rest of Studio (#106, #110).
- Initial counts and Monitor include older Threads whose latest Run failed or that are waiting for recovery, based on their current state (#102, Core #378).
- Activity keeps pending rows and counts visible during refresh instead of flashing an empty state (#108).
- **Not landed; release gate:** Show an open Thread’s own state, error, and retry controls even when it is absent from the list, and show the error in one place (#103, #107).

## Design system v2 across Studio

Conversation, sidebar, Threads, Branches, Monitor, Inbox, Analytics, Settings, Setup, and Apps now share heading, button, spacing, loading, and empty-state patterns. Links that take you somewhere are easier to distinguish from actions that operate in place (#97 and the screen rollouts).

## Conversation right panel

- Browse Thread artifacts, preview supported formats, and open older versions. Each version records a reference; it is not a copy of the underlying file (#35, Core #316).
- Reply lists now behave like attachments and artifacts when paging: a refresh rereads the loaded range, and transient read failures leave the existing rows visible and allow retrying (#77).
- The right panel opens at widths from 900 to 1179 px, replacing the old Conversation Work sheet and improving reply and delivery labels (#104). Activity rows open their details below 1180 px, and `Alt+9` toggles the right panel at any width (#113).

## Conversation

- Drafts belong to their Thread. Switching Threads no longer takes your draft into another conversation; switch back to continue writing (#109).
- Core can finish a Conversation Turn with the available text or refusal when the provider hits its output limit. It does not execute truncated tool calls or retry the attempt automatically (Core #354, #355).
- When you read earlier messages, the conversation preserves your reading position as older history loads or a deferred full message body arrives (#6).
- Branches shows where branches split and what each concluded, with excerpts in comparisons (#1).

## Settings sharing and Inbox

- Export portable settings as TOML and import them from Setup or Settings. Preview changed defaults and overwrites of same-named connections before applying. API keys and machine-specific paths are not shared; each recipient supplies their own keys (#41).
- Guide registration keeps the entered path on save failure, and connection tests show the failure category. The Settings model picker focuses search on open and returns focus on Escape without leaving Settings. Analytics distinguishes missing token peaks from lower bounds, and the Info panel distinguishes loading, failed, and empty reads. Studio appearance language remains separate from Core’s TUI and supported CLI language (#114).
- Inbox's **Awaiting you** keeps previous questions when you select **Show more**. Refreshes no longer jump back to page one or wipe an unfinished answer. The badge counts all questions rather than just loaded rows, with `128+` at the cap (#105).

## Desktop packages and robustness

- Studio release automation builds a ZIP containing the macOS `.app` and a Windows x64 ZIP with the launcher and Core, alongside the CLI archives, and includes them in `SHA256SUMS`. Signing, notarization, and automatic updates are outside this change (#98).
- An unusable common `extra_instructions` file no longer blocks new Turns. Core skips only that file and reports its path and reason in `status` and `thread get` (Core #377). Studio development and checks are isolated from the normal Core owner's settings and data (#101).
- Core can export retained conversation history to checksummed JSONL and import a verified export as a new Thread. Export is not a fixed snapshot, import does not restore Runs or Turns, and exports may contain stored reasoning data (Core #344, #345).

## Upgrading

1. Quit Core and Studio and back up the **entire Core data directory** before opening it with the new version. Back up the config separately if it lives outside that directory.
2. **Replace Core and Studio together** with Core v0.15.0 and Studio v0.4.0. IPC protocol goes from **11 to 18** and requires an exact match. An older Studio cannot connect to the upgraded Core.
3. Core upgrades the database from **schema 56 to 62** on startup. 57: output-limit provenance; 58: imported history provenance; 59: artifacts and versions; 60: receipt lanes (existing receipts default to `normal`); 61: rebuild the schedule table and its indexes; 62: instruction warnings. Migration 61 copies existing schedule rows, so the work grows with the number of schedules. Duration has not been measured. There is no automatic downgrade: restore the pre-upgrade backup to go back.
4. **Config keys:** No removed or renamed TOML keys were found between the tags. New `connections.<name>.models.include` / `.exclude` filters use case-sensitive `*` / `?` patterns and affect the model catalog, not explicit model IDs (Core #319). The `extra_instructions` format is unchanged. Hash-checked `config set` can apply an already-correct on-disk value to a stale running owner without rewriting the file (Core #377).
5. **CLI:** No removed or renamed commands or flags were found between the tags. `message send --expect-reply` was a stale documentation example, not a v0.14.0 flag; use `message ask`. Models can no longer ask their own Thread or reply to anything other than an owed duty. Omit `--thread` to ask a person; use `message cancel` to withdraw your own request (Core #370, #374).

## Verified / not verified

- **Verified in CI only:** Core v0.15.0 [Rust checks](https://github.com/tya5/shellboy/actions/runs/45258958394) and [Release binaries](https://github.com/tya5/shellboy/actions/runs/45259022310). The compared Studio tip `ced0503` passed [Checks](https://github.com/tya5/shellboy-studio/actions/runs/45275011488) and exact-pair owner acceptance on macOS, Windows, and Linux.
- **Pending:** [Release gates #111](https://github.com/tya5/shellboy-studio/issues/111) #103 (including #107) has not landed. Final-pair candidate CI and device checks remain pending. The Mac test on an APFS copy, status checks after replacement, and launching the packaged desktop build have not been verified on a real device. **Windows has not been checked on a real device.** See the [Core upgrade audit](https://github.com/tya5/shellboy-studio/issues/111#issuecomment-7113603358).
