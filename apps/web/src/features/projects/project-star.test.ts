import { beforeEach, describe, expect, it } from "vitest";
import { readStarredProjectIds, toggleStarredProjectId } from "./project-star";

const STORAGE_KEY = "inpulse.projects.starred";

describe("项目星标本地存储", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("没有记录时返回空列表", () => {
    expect(readStarredProjectIds()).toEqual([]);
  });

  it("读取合法记录", () => {
    globalThis.localStorage.setItem(STORAGE_KEY, "[2,5]");
    expect(readStarredProjectIds()).toEqual([2, 5]);
  });

  it("内容损坏、不是数组或含非法项时都不抛错", () => {
    globalThis.localStorage.setItem(STORAGE_KEY, "{oops");
    expect(readStarredProjectIds()).toEqual([]);

    globalThis.localStorage.setItem(STORAGE_KEY, '{"2":true}');
    expect(readStarredProjectIds()).toEqual([]);

    globalThis.localStorage.setItem(STORAGE_KEY, '[2,"5",0,-1,3.5,null]');
    expect(readStarredProjectIds()).toEqual([2]);
  });

  it("切换不改变其它 ID 的相对顺序", () => {
    expect(toggleStarredProjectId([7, 2, 9], 2)).toEqual([7, 9]);
    expect(toggleStarredProjectId([7, 9], 2)).toEqual([7, 9, 2]);
  });
});
