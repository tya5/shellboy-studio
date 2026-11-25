import { describe, expect, it } from "vitest";
import { summary } from "../../data/test/harness";
import { sidebarGroups } from "../src/sidebar";

const shape = (groups: ReturnType<typeof sidebarGroups>) => groups.map(group =>
  [group.key, group.rows.map(row => [row.summary.thread_id, row.depth])]);

describe("sidebar parent trees", () => {
  it.each([
    [["A"], [["A", 0], ["B", 1], ["C", 2]]],
    [["B"], [["B", 0], ["C", 1]]],
    // Undated pins tie on creation time, so they follow thread_id descending.
    [["A", "B"], [["B", 0], ["C", 1], ["A", 0], ["B", 1], ["C", 2]]],
  ])("shows each pin %j as a root with its whole subtree", (pins, expected) => {
    const tags = (id: string) => pins.includes(id) ? ["pin"] : [];
    const rows = [summary("A", { cwd: "/a", tags: tags("A") }), summary("B", { parent_thread_id: "A", cwd: "/b", tags: tags("B") }), summary("C", { parent_thread_id: "B" })];
    const groups = sidebarGroups(rows, pins, "C");
    expect(shape(groups)).toEqual([["pins", expected], ["all", [["A", 0], ["B", 1], ["C", 2]]]]);
    const copies = groups.flatMap(group => group.rows);
    expect(new Set(copies.map(row => row.key)).size).toBe(copies.length);
    expect(copies.filter(row => row.descendants > 0).every(row => row.reveal)).toBe(true);
    expect(copies.filter(row => row.summary.thread_id === "B").every(row => row.descendants === 1)).toBe(true);
    expect(groups.map(group => group.count)).toEqual([pins.length, 3]);
  });

  it("takes Pins membership from the owner's pinned set, not from tags on loaded rows", () => {
    const rows = [summary("A", { tags: ["pin"] }), summary("B")];
    expect(shape(sidebarGroups(rows, ["B"]))).toEqual([["pins", [["B", 0]]], ["all", [["A", 0], ["B", 0]]]]);
    expect(shape(sidebarGroups(rows, []))).toEqual([["all", [["A", 0], ["B", 0]]]]);
  });

  it("shows flat filter results in owner order, with only matching pins and no descendant counts", () => {
    const rows = [summary("B", { parent_thread_id: "A", tags: ["pin"] }), summary("A"), summary("D", { parent_thread_id: "A" })];
    const groups = sidebarGroups(rows, ["B"], "B", true);
    expect(shape(groups)).toEqual([["pins", [["B", 0]]], ["all", [["B", 0], ["A", 0], ["D", 0]]]]);
    expect(groups.flatMap(group => group.rows).every(row => !row.childCount && !row.descendants && !row.reveal)).toBe(true);
    expect(groups.map(group => group.count)).toEqual([1, 3]);
    expect(shape(sidebarGroups([], []))).toEqual([["all", []]]);
  });
});
