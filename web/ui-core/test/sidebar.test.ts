import { describe, expect, it } from "vitest";
import { summary } from "../../data/test/harness";
import { sidebarGroups } from "../src/sidebar";

describe("sidebar grouping", () => {
  it("puts pins first, sorts directory headings, and preserves owner order within siblings across state changes", () => {
    const rows = [summary("b",{cwd:"/beta"}),summary("z",{cwd:"/alpha"}),summary("pin2",{cwd:"/beta",tags:["pin"]}),summary("a",{cwd:"/alpha"}),summary("pin1",{cwd:"/alpha",tags:["pin"]})];
    const shape = () => sidebarGroups(rows).map(group => [group.directory,group.rows.map(row=>row.summary.thread_id)]);
    const expected = [[undefined,["pin2","pin1"]],["/alpha",["z","a"]],["/beta",["b"]]];
    expect(shape()).toEqual(expected);
    rows[1]!.activity="running";
    Object.assign(rows[3]!,{awaiting_named_count:2});
    expect(shape()).toEqual(expected);
  });

  it("summarizes listed descendants and opens the selected Thread's ancestors by default", () => {
    const parent=summary("parent",{cwd:"/alpha"});
    const child=summary("child",{cwd:"/alpha",parent_id:"parent",activity:"tools"});
    const grand=summary("grand",{cwd:"/alpha",parent_id:"child",awaiting_named_count:1});
    const [group]=sidebarGroups([parent,child,grand]);
    expect(group!.rows[0]).toMatchObject({ descendants:2, awaiting:1, running:1 });
    expect(sidebarGroups([parent,child,grand],"grand")[0]!.rows.map(row=>row.reveal)).toEqual([true,true,false]);
  });
  it("keeps ancestry facts when children move into other display groups", () => {
    const parent = summary("parent", {cwd:"/alpha"});
    const child = summary("child", {cwd:"/alpha",parent_id:"parent",activity:"tools",tags:["pin"]});
    const grand = summary("grand", {cwd:"/beta",parent_id:"child",awaiting_named_count:1});
    const rows = sidebarGroups([parent,child,grand]).flatMap(group => group.rows);
    expect(rows.find(row => row.summary.thread_id === "parent")).toMatchObject({descendants:2,awaiting:1,running:1,childCount:0});
  });

});
