# Shellboy Studio: user guide

[日本語](#日本語)

## Install and open Studio

Download Studio from the [releases page](https://github.com/tya5/shellboy-studio/releases) and verify the download against `SHA256SUMS`. Studio v0.4.1 pairs with Core v0.15.0 (protocol 18); see the [exact pairing](../release-v0.4.1.md). Before upgrading an existing installation, quit both programs and back up the entire Core data directory and any config outside it. Core applies migrations on startup; there is no automatic downgrade.

- **macOS 14 or later, Apple silicon:** Extract the desktop ZIP and open **Shellboy Studio.app**. It is unsigned and not notarized. If Gatekeeper blocks it, review the warning and use **Open Anyway** in System Settings > Privacy & Security only if you trust the download.
- **Windows x64:** Extract the entire desktop ZIP, keep `Shellboy Studio.exe` and `shellboy.exe` together, and open `Shellboy Studio.exe`. See the [Windows desktop guide](windows-desktop.txt) for security warnings and shortcut arguments. The executable is unsigned; follow your organization's policy.
- **CLI (including Linux x64):** Start `shellboy serve` or use a running Shellboy TUI that owns the same data directory. In another terminal run `shellboy-studio` and open the printed URL. Keep its token private. The bridge binds to `127.0.0.1:8751` by default. If you use a custom Core data directory, pass the same `--data-dir DIR` to Studio or set `SHELLBOY_DATA_DIR`.

The desktop app opens your default browser and signs in locally. It attaches to an owner already running on the selected data directory or starts its bundled Core if needed. To use custom Core settings, launch with `--config PATH` and `--data-dir PATH`; relative paths are resolved from the launch folder. Don't start a second owner for the same data. Opening the app again reopens the running Studio, but a different requested data directory requires quitting the existing Studio first.

## Connect a model

If there is no model connection, choose **Connect a model service**. Select your provider or proxy, verify the address and API format, and provide a key if required. A Claude or ChatGPT subscription login is not an API key. Supported presets can offer to use a key already in the Core owner's environment. **Test connection** asks for the model list; it doesn't send a conversation or guarantee that the provider verified the key. Choose a model or enter its exact ID, then select **Save and use this connection** and **Go to Conversation**. Embeddings are optional. If you already have a portable TOML file, choose **Import settings** instead.

## Find Threads and read a conversation

The v2 interface uses consistent headings, links, action buttons, and loading and empty states. Change Studio's display language in **Settings > Appearance > Language**; this is separate from Core's terminal language.

- Use **Pin** in a Thread's row menu to put it in **Pinned**, above **All**. The pinned band can include older Threads outside the loaded **All** list, and orders them by creation time, newest first; entries without a creation time come last.
- **Archived**, below **All**, lists archived Threads separately. **All** excludes them; archived Threads with a pin remain in **Pinned**. In **Monitor**, use **Archive scope**: **Active** excludes archived Threads, **All archives** includes them, and **Archived** shows only archived Threads. This does not change the sidebar.
- **Awaiting you** is a separate sidebar filter. It clears search, tag, and directory filters and hides **Pinned** and **Archived**. Choosing any of those filters turns **Awaiting you** off. The **Awaiting you** screen also lists requests directed to you. A count with `+` is a lower bound.
- In **Conversation**, send a message from the composer, expand tool output, or use **Stop** for a Run that can be stopped. A recovery wait does not clear a reply duty. If recovery offers **Retry**, it may incur additional usage; if unavailable, read the reason shown. Drafts stay with their Thread when you switch.

### Conversation side panel

In **Conversation**, use **Expand right panel** when the panel is collapsed, or press `Alt+9`. On a phone, the **Thread panel** picker switches sections, and details open full-screen. Use the button named after the section (for example, **Activity**) to go back. Logs offer **Wrap lines** and **Raw text**; wrapping does not change what is copied. Use **Load earlier messages** when earlier history is available. The composer adjusts to the on-screen keyboard, and the sidebar row menu has its own touch target.

With a keyboard, use Tab or Shift+Tab to leave a row menu and continue outside that row. Collapsed Work rows keep a focus outline, and Tab can reach panel content with no controls. If **Stop** disappears while focused, focus returns to the composer. Global shortcuts are ignored in dialogs, while editing or composing text with an IME, and when a control has already handled the key.

For v0.4.2, pending landing: higher-contrast counts on tabs such as **Reply needed** and **Awaiting reply**. The sidebar also gains screen-reader tree navigation, focused conversation rows stay mounted during scrolling, and Studio announces **Reply is arriving.** and **Reply saved.** without announcing each chunk. The page cannot guarantee where a screen reader’s independent browse cursor stays.

| Tab | What to look for |
| --- | --- |
| **Activity** | Running work and pending deliveries. Open a row for details and available actions, such as inspecting a tool's output. |
| **Reply needed** | Requests this Thread owes a reply to. Open the request and use its reply action when available. |
| **Awaiting reply** | Requests this Thread is waiting to have answered, not requests you need to answer. |
| **Possessions** | **Artifacts** and **Attachments** when supported. Open an artifact to inspect its available preview and versions. Versions record references, not copies of files. |
| **Analytics** | This Thread's **Conversation tokens** (retained history, including failed and incomplete requests), **Summary tokens**, and **Recent compactions**. |
| **Settings** | Settings for this Thread, not the global **Settings** screen. |

For model messages, **From Thread** is the recorded sender ID; **Current title** can change or be unavailable. A **Self-asserted label** is supplied by the sender and is not verified. Follow the ID link to inspect the sender.

### Delete selected Threads

In the sidebar use **Select Threads**, select the Threads, then choose **Delete**. Review the exact names and IDs; active scheduled executions listed in the preview will be stopped. Live or stopping Runs block deletion. **Delete selected Threads** permanently deletes the selected set in a single all-or-none operation (up to 256 on the matching owner). Unselected descendants stay. If the selection or targets change, review and confirm the new preview. Archive is a separate action.

## Inspect usage and cost

Open the global **Analytics** screen and choose a **Period**. Under **By Thread**, compare **Excl. cached** (conversation other plus all summaries), **Total**, **Cached input** (conversation only), or **Summary tokens**. The bars and shares follow the selected metric. An incomplete scan does not show rankings. Open a Thread row for its exact breakdown and model usage in the same period; **Back to ranking** returns to that row. Summary usage is separate and is not attributed to models. **Show more usage rows** reveals more rows already read. Incomplete totals can be lower bounds; a missing value is not zero. **Cache rate** is the cached share of conversation input where the counters support a comparison. **Effective tokens** uses editable cached-input and output weights stored in this browser. Neither that value nor **Summary cost** is a currency amount or a provider bill.


For v0.4.2, pending landing: **By Thread** adds **Comparison metric**: **Excl. cached** (default; other conversation tokens plus all summary tokens), **Total**, **Cached input** (conversation only), and **Summary tokens**. Rank, bars, exact counts and shares follow the selected metric. An incomplete scan does not show a ranking. Open a Thread's breakdown for the same **Period**, then use **Back to ranking**. The older counters and model breakdowns remain under **Detailed usage table**.

## Share settings with a colleague

1. In global **Settings > Connections > Share settings**, choose **Export file**. The `shellboy-settings.toml` download contains portable settings, model filters and defaults, not API key values, custom headers or request bodies, or local paths. Studio names connections omitted from the export.
2. Open **Import settings** on the first-run screen, or find **Import settings** under **Share settings** and choose **Change**. Choose or drop the TOML file. Review the connections, same-name overwrites, new defaults and any credential routing warnings, including the old and new endpoint, format, and key header. Confirm the routing changes only if you trust them, then choose **Apply settings**.
3. Enter your own key where needed and choose **Save key**, or choose **This connection does not need a key** only when that's true. On first run, continue with **Start a conversation**. If a restart is required, use **Restart owner** for the desktop-managed Core or restart the independently started owner yourself when safe to do so.

## Open Studio at login

In authenticated desktop Studio, go to **Settings > Studio > Startup** and choose **Open Studio at login**. It is off by default and Studio does not prompt during setup. This opens Studio as if you opened the app normally, with the default launch arguments. It does not register Core as an OS service.

On macOS, manage or approve the app in **System Settings > General > Login Items & Extensions > Open at Login**. macOS may refuse registration, including for a bundle that does not meet its code-signing requirements. On Windows, Studio creates one shortcut for your account in `shell:startup`. If Studio cannot verify if Windows will launch it, check **Settings > Apps > Startup**; if it is not listed there, remove the **Shellboy Studio** shortcut from `shell:startup` to turn it off. Changes made outside Studio aren't undone. This option is unavailable on Linux (no desktop launcher) and in remote browsers.

## Stop or restart the desktop app

Closing the browser tab does not stop Studio. Use **Quit Studio** to stop the bridge and request a normal shutdown of the Core child it started. Studio force-terminates that child only if shutdown fails or it does not exit within the grace period. An independently started Core keeps running.

If a bundled Core crashes after it is ready, Studio tries one immediate automatic restart per launch or manual start. Becoming ready again does not reset the allowance. A second crash shows the last failure; use **Restart owner** to try again. A clean exit or failure before initial readiness is not retried. **Restart owner** checks for an already running owner before starting Core; Studio doesn't stop or automatically restart an independent owner. For diagnostics, see `studio.log` and `owner.log` under `~/Library/Application Support/shellboy-studio` on macOS or `%APPDATA%\shellboy-studio` on Windows. Don't share tokens or private log contents.

## Open on another device

Keep the bridge on loopback. Use a private HTTPS endpoint and add its exact hostname to Studio with `--allow-host HOSTNAME`. A VPN alone is not HTTPS or user authentication. For example, with both devices on the same Tailscale tailnet and access allowed to the Studio computer:

```sh
shellboy-studio --allow-host example-computer.example-tailnet.ts.net
# In another terminal, on the Studio computer:
tailscale serve --bg http://127.0.0.1:8751
tailscale serve status
```

Use your computer's full MagicDNS hostname. See [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve). Do not use Funnel. In global **Settings > Studio**, under **Open on a phone**, choose **Create QR code** and scan it on the phone. The code is usable once and expires after 120 seconds. Never share the local token URL, QR code, or its contents. If pairing fails, check the exact hostname, HTTPS and network access, then reissue an expired code.

## Explicit Development Authentication Opt-Out

Keep default authentication for normal use. Explicit `--no-auth` is for disposable development over loopback or deliberately trusted private access through HTTPS with an exact allowed host. Anyone who can reach Studio in this mode can operate it, including other local processes and reachable tailnet users. Host and Origin checks are not authentication. Never use this mode on the public internet or via Funnel. Studio does not configure or verify your proxy or VPN. **Authentication off** is visible and phone pairing is disabled. If you enable `/debug`, it also lacks token/session protection in this mode. Use the console CLI for `--no-auth`, not the desktop launcher.

## Apps, guides, and troubleshooting

**Apps** lists local Studio web apps. Review an app and its permissions before using it: actions execute on the Studio host. `shellboy-studio guide user` and `shellboy-studio guide agent` print the bundled guides without starting the bridge. Startup rewrites `$SHELLBOY_DATA_DIR/studio/agent-guide.md` and the managed Apps README.

If Studio cannot reach Core, check that Core is running under the same OS account, the data directories match, and both binaries match the release pairing. Studio does not downgrade the protocol. Do not reset data or restart an owner running work just to clear a mismatch. Follow the release notes for verification limits; the presence of an archive is not proof of a physical-device test.

## 日本語

### インストールと起動

[リリースページ](https://github.com/tya5/shellboy-studio/releases)からダウンロードし、`SHA256SUMS` で照合します。Studio v0.4.1 は Core v0.15.0（プロトコル 18）と組み合わせます。正確な組み合わせは[リリースノート](../release-v0.4.1.md)を参照してください。更新前に両方を終了し、Core のデータディレクトリ全体と、その外にある設定ファイルをバックアップしてください。Core は起動時にデータを移行し、自動では元に戻せません。

- **Apple シリコン搭載 Mac（macOS 14 以降）：** デスクトップ ZIP を展開し、**Shellboy Studio.app** を開きます。署名・公証はありません。Gatekeeper に止められた場合は警告を確認し、入手元を信頼できる場合だけ「システム設定」>「プライバシーとセキュリティ」から開いてください。
- **Windows x64：** デスクトップ ZIP をすべて展開し、`Shellboy Studio.exe` と `shellboy.exe` を同じフォルダに置いて `Shellboy Studio.exe` を開きます。署名はありません。警告やショートカットの設定は [Windows デスクトップガイド](windows-desktop.txt)を参照し、所属組織の方針に従ってください。
- **CLI（Linux x64 を含む）：** `shellboy serve` を起動するか、同じデータディレクトリを使用中の Shellboy TUI を使います。別のターミナルで `shellboy-studio` を実行し、表示された URL を開きます。URL のトークンは共有しないでください。既定の待ち受け先は `127.0.0.1:8751` です。Core のデータディレクトリを変更している場合は、Studio にも同じ `--data-dir DIR` または `SHELLBOY_DATA_DIR` を指定してください。

デスクトップ版は既定のブラウザを開き、ローカルで認証します。指定のデータディレクトリに稼働中のオーナーがいれば接続し、いなければ同梱の Core を起動します。Core の設定とデータの場所は `--config PATH` と `--data-dir PATH` で指定でき、相対パスの基準は起動フォルダです。同じデータに対して別のオーナーを起動しないでください。アプリをもう一度開くと既存の Studio が開きます。別のデータディレクトリを使う場合は、先に既存の Studio を終了してください。

### モデルの初期設定

接続がなければ **モデルのサービスに接続** を選びます。サービスやプロキシを選び、接続先と API 形式を確認して、必要な場合はキーを入力します。Claude や ChatGPT の購読ログインは API キーではありません。一部のサービスでは Core オーナーの環境にあるキーを使えます。**接続を確認** はモデル一覧の取得で、会話は送らず、キーが提供元で検証されたとは限りません。一覧からモデルを選ぶか正確な ID を入力し、**保存してこの接続を使う**、**会話へ進む** の順に進みます。埋め込みは任意です。共有用の TOML がある場合は **設定を取り込む** を選べます。

### スレッド一覧と会話

デザインシステム v2 では、見出し、移動リンク、操作ボタン、読み込み中・空の表示が各画面で統一されています。Studio の表示言語は **設定 > 外観 > 言語** で変更できます。Core のターミナル表示言語とは別です。

- 行メニューの **ピン留め** で **すべて** の上にある **ピン留め** 欄に追加します。**すべて** の読み込み範囲外にある古いスレッドも表示されます。作成日時の新しい順で、日時が不明なものは最後です。
- **すべて** の下の **アーカイブ済み** にアーカイブしたスレッドが表示されます。**すべて** には表示されませんが、ピン留めしたものは **ピン留め** に残ります。**モニター** の **アーカイブ範囲** では、**通常** で除外し、**すべて** で含め、**アーカイブ済み** でアーカイブしたものだけを表示します。サイドバーには影響しません。
- **あなた待ち** の絞り込みを有効にすると検索語、タグ、ディレクトリの条件が解除され、**ピン留め** と **アーカイブ済み** が隠れます。いずれかの条件を選び直すと **あなた待ち** は解除されます。**あなた待ち** 画面では自分宛ての依頼も確認できます。`+` 付きの件数は下限です。
- **会話** では入力欄から送信し、ツール出力を展開できます。停止できる Run には **停止** を使えます。復旧待ちになっても返信義務は消えません。**再試行** では追加の利用量が発生する場合があります。使えないときは画面の理由を確認してください。書きかけはスレッドを切り替えても元のスレッドに残ります。

#### 右パネル

**会話** の **右パネルを展開** で右パネルを開きます。`Alt+9` でも開閉できます。スマートフォンでは **スレッドパネル** で表示する項目を選べます。詳細は全画面で開き、**動作** など項目名のボタンで元に戻ります。ログは **行を折り返す** と **生テキスト** を切り替えられ、折り返してもコピーする内容は変わりません。履歴が残っている場合は **以前のメッセージを読み込む** を使えます。画面キーボードに合わせて入力欄の位置が調整され、行メニューはスレッドのリンクとは別にタップできます。

Tab または Shift+Tab で行メニューから出ると、その行の外の操作に移ります。閉じた作業行にもフォーカス枠が表示され、操作のないパネルにも Tab で移動できます。フォーカス中の **停止** が消えると、入力欄に戻ります。ダイアログ内、編集中、IME 変換中、または操作側が処理済みのキーでは、全体のショートカットは動作しません。

v0.4.2 向け（反映待ち）：**要返信** や **返信待ち** などの件数の文字が読みやすくなります。サイドバーは読み上げでツリーとして操作でき、スクロール中もフォーカス中の会話行は維持されます。読み上げ通知は **返信を受信中です。** と **返信を保存しました。** のみで、受信のたびに通知しません。読み上げソフト独自の閲覧カーソルの位置はページ側では保証できません。

| タブ | 内容 |
| --- | --- |
| **動作** | 実行中の作業や配信待ちの項目。行を開くとツール出力などの詳細と利用できる操作が表示されます。 |
| **要返信** | このスレッドが返答する依頼。依頼を開き、利用できる場合は返信操作を使います。 |
| **返信待ち** | このスレッドが送った依頼のうち、相手の返答を待っているもの。 |
| **持ち物** | 対応する場合に **成果物** と **添付** を表示します。成果物を開くと利用できるプレビューと版を確認できます。版に記録されるのは参照先で、ファイルのコピーではありません。 |
| **分析** | このスレッドの **会話のトークン**（残っている履歴の完了・失敗・未完了の要求）、**要約のトークン**、**最近の圧縮**。 |
| **設定** | このスレッドだけの設定。全体の **設定** とは別です。 |

モデルからのメッセージでは **送信元Thread** の ID が送信元です。**現在のタイトル** は変わることがあり、**自己申告ラベル** は送信者が付けた未検証の表示です。送信元を確認するには ID のリンクを開きます。

#### スレッドの一括削除

サイドバーで **スレッドを選択** を選び、対象にチェックを入れて **削除** を押します。プレビューで名前と ID、停止対象となるスケジュール実行を確認してください。実行中または停止処理中の Run があると削除できません。**選択したスレッドを削除** を押すと、対応するオーナーでは最大 256 件を一度の操作で全件削除するか、何も削除しません。選択していない子孫は残ります。対象が変わった場合は新しいプレビューで確認し直してください。アーカイブは別の操作です。

### 使用量とコストを確認する

全体の **分析** で **期間** を選び、**スレッド別** で **キャッシュを除く**（会話のその他と要約全体）、**合計**、**キャッシュ済み入力**（会話のみ）、**要約のトークン** を比較できます。棒と割合は選択項目に対応し、集計が不完全なときは順位を表示しません。行を開くと同じ期間の内訳とモデル別使用量を確認でき、**順位に戻る** で元の行に戻ります。要約は別集計で、モデル別には配分しません。**使用量の続きを表示** は読み込み済みの行を追加で表示します。集計が不完全な場合は下限になり、値がない場合はゼロとは限りません。**キャッシュ率** は比較できる会話入力のうちキャッシュを使った割合です。**実効トークン** のキャッシュ入力と出力の重みはブラウザに保存されます。実効トークンも **要約コスト** も金額ではありません。


v0.4.2 向け（反映待ち）：**スレッド別** の **比較する項目** で **キャッシュを除く**（既定。会話のその他と要約全体）、**合計**、**キャッシュ済み入力**（会話のみ）、**要約のトークン** を選べます。順位、棒、件数、割合は選んだ項目に対応します。集計が不完全な場合は順位を表示しません。行を開くと同じ **期間** の内訳を確認でき、**順位に戻る** で元の行に戻ります。従来の使用量やモデル別の内訳は **詳細な使用量の表** にあります。

### 設定を共有する

1. 全体の **設定 > 接続 > 設定を共有** で **ファイルに書き出す** を選びます。`shellboy-settings.toml` には移せる接続設定、モデルの絞り込み、既定値が入ります。API キーの値、カスタムヘッダーやリクエスト本文、端末固有のパスは入りません。対象外の接続は Studio が表示します。
2. 初期設定の **設定を取り込む** を選ぶか、**設定を共有** 内の **設定を取り込む** の行で **変更** を選びます。TOML を選択またはドロップし、接続、同名項目の上書き、既定値、キーの送信先変更の警告を確認します。変更前後の接続先、形式、キーヘッダーを信頼できる場合のみ確認して **設定を適用** を押します。
3. 必要な接続ごとに自分のキーを入力して **キーを保存** を押します。不要な接続に限り **この接続にはキーが不要** を選びます。初期設定では **会話を始める** で進みます。再起動が必要な場合、デスクトップ版が起動した Core には **再起動** を使い、別途起動した Core は作業を止めてよいときに自分で起動し直してください。

### ログイン時に Studio を開く

認証付きのデスクトップ版で **設定 > Studio > 起動 > ログイン時に Studio を開く** を選びます。既定はオフで、初期設定時に確認は出ません。通常どおり既定の起動引数で Studio を開きます。Core を OS のサービスとして登録することはありません。

macOS では **システム設定 > 一般 > ログイン項目と機能拡張 > ログイン時に開く** で管理・承認できます。署名の要件を満たさない場合など、macOS が登録を拒否することがあります。Windows では自分の `shell:startup` にショートカットを 1 つ作ります。Studio で起動状態を確認できない場合は **設定 > アプリ > スタートアップ** を確認してください。そこに表示されない場合は、`shell:startup` から **Shellboy Studio** のショートカットを削除すると無効にできます。Studio が外部での変更を元に戻すことはありません。Linux（デスクトップランチャー未提供）とリモートブラウザでは利用できません。

### デスクトップ版の終了と再起動

ブラウザのタブを閉じても Studio は停止しません。**終了** は Studio を止め、Studio が起動した Core に通常終了を要求します。要求に失敗した場合や猶予時間内に終了しない場合だけ強制終了します。別途起動したオーナーはそのまま動きます。

同梱 Core が準備完了後に異常終了した場合、Studio の起動または手動で起動し直してから一度だけ、すぐに自動再起動します。再び準備完了になっても回数は戻りません。次に失敗したら最後のエラーを表示するので **再起動** を選んでください。正常終了や最初の準備完了前の失敗では自動再起動しません。**再起動** は稼働中のオーナーを先に確認し、Studio が起動していないオーナーを停止・自動再起動しません。診断ログ `studio.log` と `owner.log` は macOS では `~/Library/Application Support/shellboy-studio`、Windows では `%APPDATA%\shellboy-studio` にあります。トークンや非公開ログを共有しないでください。

### スマホなど別の端末で開く

Studio はループバックのまま、別の端末から届くプライベート HTTPS の入口を用意し、正確なホスト名を `--allow-host HOSTNAME` で許可します。VPN だけでは HTTPS や利用者認証にはなりません。[Tailscale Serve の例](#open-on-another-device)は同じ tailnet に両端末を参加させて使います。公開する Funnel は使わないでください。全体の **設定 > Studio > スマホで開く** で **QR コードを作成** を選び、スマホで読み取ります。コードは一度だけ使え、120 秒で失効します。トークン付き URL や QR コードは共有しないでください。接続できない場合はホスト名、HTTPS、ネットワークを確認し、期限切れならコードを発行し直します。

### 開発時の認証なしモード

通常は既定の認証を使います。`--no-auth` はループバック、または正確な許可ホストと HTTPS を設定した、信頼できる非公開の開発環境向けです。到達できる別プロセスや利用者も操作できます。Host と Origin の検査は認証ではありません。インターネットや Funnel には絶対に公開しないでください。Studio はプロキシや VPN の設定を検証しません。**認証なし** が表示され、スマホのペアリングは使えなくなります。`/debug` を有効にすると、その画面もトークン・セッションなしで接続できます。このフラグはデスクトップ版ではなく CLI 版で使います。

### アプリ、ガイド、トラブル対応

**アプリ** は Studio のローカル Web アプリ一覧です。操作は Studio が動く端末で実行されるので、使う前にコードと権限を確認してください。`shellboy-studio guide user` と `shellboy-studio guide agent` で Studio を起動せずに同梱ガイドを読めます。起動時には `$SHELLBOY_DATA_DIR/studio/agent-guide.md` と管理対象の Apps README が上書きされます。

Core に接続できない場合は、同じ OS アカウントで起動したか、データディレクトリが一致するか、リリースノートどおりの組み合わせかを確認します。古いプロトコルへの切り替えはありません。不一致を解消するためにデータを初期化したり、作業中のオーナーを無断で再起動したりしないでください。配布物があるだけでは実機検証済みとはいえません。検証範囲はリリースノートを参照してください。
