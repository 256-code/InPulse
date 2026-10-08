/**
 * 项目成员展示顺序（2026-10-08 用户要求「组长要放在第一位」）。
 *
 * 只把组长提到最前，其余成员保持服务端返回的顺序——`Array.prototype.sort`
 * 自 ES2019 起保证稳定，因此这里不需要额外的次要键。
 * 组长在活跃成员中唯一（ADR-053），`role` 一定出现在接口返回里。
 * 两个成员视图（管理视图与普通成员只读视图）共用本函数，改顺序只改这里。
 */
export function orderMembersLeaderFirst<
  T extends { readonly role: "MEMBER" | "LEADER" },
>(members: readonly T[]): readonly T[] {
  return [...members].sort(
    (a, b) => Number(b.role === "LEADER") - Number(a.role === "LEADER"),
  );
}
