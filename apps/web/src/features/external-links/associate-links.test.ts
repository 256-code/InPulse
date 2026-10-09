import { it, expect, vi } from "vitest";
import { ApiError, type InpulseApiClient } from "@generated/api";
import { associateLinks } from "./associate-links";
const urlA = "https://github.com/a/b/commit/aaa1111";
const urlB = "https://github.com/a/b/issues/12";
function conflict() {
  return new ApiError(409, {
    code: "EXTERNAL_LINK_ALREADY_ASSOCIATED",
    message: "已关联",
    details: {},
    requestId: "r",
  });
}
it("逐条关联并回填版本，409「已关联」按成功处理", async () => {
  const add = vi
    .fn()
    .mockResolvedValueOnce({ rowVersion: 8 })
    .mockRejectedValueOnce(conflict());
  const failures = await associateLinks(
    {
      listExternalLinks: vi.fn().mockResolvedValue({ rowVersion: 7 }),
      addExternalLink: add,
    } as unknown as InpulseApiClient,
    "TASK",
    3,
    [urlA, urlB],
    "csrf",
  );
  expect(failures).toEqual([]);
  expect(add).toHaveBeenCalledTimes(2);
  // 第二条用的是第一条响应回填的版本，不是最初读到的 7。
  expect(add.mock.calls[0]![3].headers["If-Match"]).toBe('"7"');
  expect(add.mock.calls[1]![3].headers["If-Match"]).toBe('"8"');
  expect(add.mock.calls[1]![3].headers["x-csrf-token"]).toBe("csrf");
});
it("其余失败带原始错误返回，且不影响后面的条目", async () => {
  const forbidden = new ApiError(403, {
    code: "FORBIDDEN",
    message: "无权限",
    details: {},
    requestId: "r",
  });
  const add = vi
    .fn()
    .mockRejectedValueOnce(forbidden)
    .mockResolvedValueOnce({ rowVersion: 9 });
  const failures = await associateLinks(
    {
      listExternalLinks: vi.fn().mockResolvedValue({ rowVersion: 7 }),
      addExternalLink: add,
    } as unknown as InpulseApiClient,
    "TASK",
    3,
    [urlA, urlB],
    "csrf",
  );
  expect(failures).toEqual([{ url: urlA, error: forbidden }]);
  expect(add).toHaveBeenCalledTimes(2);
});
it("读取目标版本失败时整批算失败且不写任何链接", async () => {
  const broken = new Error("boom");
  const add = vi.fn();
  const failures = await associateLinks(
    {
      listExternalLinks: vi.fn().mockRejectedValue(broken),
      addExternalLink: add,
    } as unknown as InpulseApiClient,
    "TASK",
    3,
    [urlA, urlB],
    "csrf",
  );
  expect(failures.map((failure) => failure.url)).toEqual([urlA, urlB]);
  expect(failures.every((failure) => failure.error === broken)).toBe(true);
  expect(add).not.toHaveBeenCalled();
});
it("空清单直接返回，不读版本也不写链接", async () => {
  const list = vi.fn();
  const add = vi.fn();
  const failures = await associateLinks(
    {
      listExternalLinks: list,
      addExternalLink: add,
    } as unknown as InpulseApiClient,
    "TASK",
    3,
    [],
    "csrf",
  );
  expect(failures).toEqual([]);
  expect(list).not.toHaveBeenCalled();
  expect(add).not.toHaveBeenCalled();
});
