import type { Lang } from "./i18n";

/** Prompts only: Studio does not bundle the resulting applications. */
export const APP_TEMPLATES: readonly { id: string; title: Record<Lang, string>; draft: Record<Lang, string> }[] = [
  { id: "todo", title: { en: "Todo list", ja: "Todo リスト" }, draft: { en: "Build a todo list to add, complete and organize tasks.", ja: "タスクの追加、完了、整理ができる Todo リストを作ってください。" } },
  { id: "diff", title: { en: "Git diff viewer", ja: "Git 差分ビューア" }, draft: { en: "Build a viewer for the current Git working tree's changes.", ja: "現在の Git 作業ツリーの変更を表示するビューアを作ってください。" } },
  { id: "notes", title: { en: "Notepad", ja: "メモ帳" }, draft: { en: "Build a notepad for creating and editing notes.", ja: "メモを作成、編集できるメモ帳を作ってください。" } },
  { id: "dashboard", title: { en: "Thread dashboard", ja: "スレッドのダッシュボード" }, draft: { en: "Build a dashboard showing my Threads and their current states.", ja: "スレッドと現在の状態を表示するダッシュボードを作ってください。" } },
  { id: "launcher", title: { en: "Task launcher", ja: "定型作業のランチャー" }, draft: { en: "Build a launcher for routine tasks, with confirmation before running them.", ja: "実行前に確認できる定型作業のランチャーを作ってください。" } },
];

/** Folders seen in the current thread list come first in list order; the rest retain the owner's order. */
export function recentAppFolders(folders: readonly string[], recent: readonly string[]): string[] {
  const known = new Set(folders);
  return [...new Set([...recent.filter((folder) => known.has(folder)), ...folders])];
}
