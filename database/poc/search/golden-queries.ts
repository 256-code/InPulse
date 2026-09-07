export type ProjectKey = "p1" | "p2" | "p3" | "p4" | "p5" | "p6";

export type SearchEntityType =
  | "PROJECT"
  | "MODULE"
  | "FEATURE"
  | "TASK"
  | "CHANGE_RECORD"
  | "EXTERNAL_LINK"
  | "TASK_GROUP";

export type QueryCategory =
  | "zh-short"
  | "code"
  | "english"
  | "mixed"
  | "punctuation"
  | "no-result"
  | "edge";

export type QueryPolicy =
  | "normal"
  | "no-result"
  | "empty"
  | "too-short"
  | "too-long"
  | "special"
  | "edge";

export interface GoldenQuerySpec {
  readonly id: string;
  readonly category: QueryCategory;
  readonly policy: QueryPolicy;
  readonly query: string;
  readonly expectedText: string | null;
  readonly expectedProjectKey: ProjectKey | null;
  readonly expectedEntityType: SearchEntityType | null;
}

export const GOLDEN_QUERY_VERSION = "phase0-v1";

type ExpectedTuple = readonly [
  query: string,
  expectedText: string,
  projectKey: ProjectKey,
  entityType: SearchEntityType
];

function expectedCases(
  category: QueryCategory,
  entries: readonly ExpectedTuple[]
): Array<Omit<GoldenQuerySpec, "id">> {
  return entries.map(([query, expectedText, projectKey, entityType]) => ({
    category,
    policy: "normal" as const,
    query,
    expectedText,
    expectedProjectKey: projectKey,
    expectedEntityType: entityType
  }));
}

function noResultCases(
  category: QueryCategory,
  entries: readonly string[],
  policy: QueryPolicy = "no-result"
): Array<Omit<GoldenQuerySpec, "id">> {
  return entries.map((query) => ({
    category,
    policy,
    query,
    expectedText: null,
    expectedProjectKey: null,
    expectedEntityType: null
  }));
}

const zhShortCases: readonly ExpectedTuple[] = [
  ["登录", "登录模块重构与 Session 安全加固", "p1", "FEATURE"],
  ["项目", "项目创建、成员与未分类模块", "p2", "PROJECT"],
  ["任务", "任务完成与迭代记录发布", "p3", "TASK"],
  ["搜索", "全局搜索投影和权限过滤", "p4", "FEATURE"],
  ["发布", "迭代记录发布与版本保留", "p5", "CHANGE_RECORD"],
  ["合并", "任务合并为主任务与来源分支", "p6", "TASK_GROUP"],
  ["通知", "站内通知轮询与未读状态", "p1", "MODULE"],
  ["审计", "操作审计哈希链一致性", "p2", "MODULE"],
  ["概览", "项目概览统计与最近动态", "p3", "PROJECT"],
  ["动态", "项目动态时间线脱敏展示", "p4", "MODULE"],
  ["成员", "项目成员管理权限", "p5", "MODULE"],
  ["权限", "资源权限与 AuthorizedProjectScope", "p6", "MODULE"],
  ["模块", "模块管理和归档状态", "p1", "MODULE"],
  ["功能", "功能档案与影响范围", "p2", "FEATURE"],
  ["记录", "迭代记录三段式内容", "p3", "CHANGE_RECORD"],
  ["遗留", "遗留问题转为任务", "p4", "TASK"],
  ["恢复", "作废迭代记录恢复", "p5", "CHANGE_RECORD"],
  ["作废", "迭代记录作废与可见性", "p6", "CHANGE_RECORD"],
  ["草稿", "迭代记录草稿编辑", "p1", "CHANGE_RECORD"],
  ["版本", "正式记录版本不可变", "p2", "CHANGE_RECORD"]
];

const codeCases: readonly ExpectedTuple[] = [
  ["INP-T-2026-0001", "任务 INP-T-2026-0001 登录联调", "p1", "TASK"],
  ["PR-42", "Pull Request PR-42 权限修复", "p2", "EXTERNAL_LINK"],
  ["ISSUE-17", "Issue ISSUE-17 搜索召回问题", "p3", "EXTERNAL_LINK"],
  ["TASK-GROUP-009", "聚合组 TASK-GROUP-009 合并", "p4", "TASK_GROUP"],
  ["CR-2026-0031", "迭代记录 CR-2026-0031 发布", "p5", "CHANGE_RECORD"],
  ["PG-18-6", "PostgreSQL PG-18-6 基线", "p6", "PROJECT"],
  ["GIN-INDEX-001", "GIN-INDEX-001 trigram 索引验证", "p1", "MODULE"],
  ["MFA-REAUTH-05", "MFA-REAUTH-05 管理员重认证", "p2", "FEATURE"],
  ["CSRF-ROTATE-02", "CSRF-ROTATE-02 Token 轮换", "p3", "FEATURE"],
  ["SESSION-TOKEN-01", "SESSION-TOKEN-01 哈希存储", "p4", "FEATURE"],
  ["API-V1-SEARCH", "API-V1-SEARCH 搜索接口", "p5", "FEATURE"],
  ["PROJECT-ALPHA", "PROJECT-ALPHA 项目迁移", "p6", "PROJECT"],
  ["MODULE-CORE", "MODULE-CORE 核心模块", "p1", "MODULE"],
  ["FEATURE-LOGIN", "FEATURE-LOGIN 登录功能", "p2", "FEATURE"],
  ["CHANGE-RECORD-V1", "CHANGE-RECORD-V1 首版记录", "p3", "CHANGE_RECORD"],
  ["LEFTOVER-0007", "LEFTOVER-0007 遗留项转任务", "p4", "TASK"],
  ["EXTERNAL-LINK-88", "EXTERNAL-LINK-88 GitHub 链接", "p5", "EXTERNAL_LINK"],
  ["RECOVERY-CODE-2026", "RECOVERY-CODE-2026 恢复码", "p6", "FEATURE"],
  ["SEARCH-PROJECTION", "SEARCH-PROJECTION 投影写入", "p1", "MODULE"],
  ["NPM-11-19", "NPM-11-19 pnpm 基线", "p2", "PROJECT"]
];

const englishCases: readonly ExpectedTuple[] = [
  ["login", "login session rotation and CSRF", "p1", "FEATURE"],
  ["mfa", "mfa reauthentication and TOTP", "p2", "FEATURE"],
  ["csrf", "csrf token issue and verify", "p3", "FEATURE"],
  ["postgres", "postgres 18 transaction and roles", "p4", "PROJECT"],
  ["drizzle", "drizzle schema and migration", "p5", "MODULE"],
  ["session", "session token hash and expiry", "p6", "FEATURE"],
  ["project", "project member access control", "p1", "PROJECT"],
  ["task", "task status history and assignment", "p2", "TASK"],
  ["search", "search projection query scope", "p3", "FEATURE"],
  ["audit", "audit chain head lock", "p4", "MODULE"],
  ["notification", "notification recipient and cursor", "p5", "MODULE"],
  ["activity", "activity projection visibility", "p6", "MODULE"],
  ["permission", "permission matrix server check", "p1", "MODULE"],
  ["module", "module scope for task impact", "p2", "MODULE"],
  ["feature", "feature archive state", "p3", "FEATURE"],
  ["change record", "change record version snapshot", "p4", "CHANGE_RECORD"],
  ["restore", "restore voided change record", "p5", "CHANGE_RECORD"],
  ["draft", "draft change record payload", "p6", "CHANGE_RECORD"],
  ["detach", "detach source task from group", "p1", "TASK_GROUP"],
  ["gin", "gin trigram index explain", "p2", "MODULE"]
];

const mixedCases: readonly ExpectedTuple[] = [
  ["登录2026", "登录2026 功能重构", "p1", "FEATURE"],
  ["PR-42 权限修复", "PR-42 权限修复合入", "p2", "EXTERNAL_LINK"],
  ["项目ALPHA", "项目ALPHA 成员迁移", "p3", "PROJECT"],
  ["搜索“全局”", "搜索“全局”跨项目范围", "p4", "FEATURE"],
  ["任务TASK-100", "任务TASK-100 指派变更", "p5", "TASK"],
  ["完成迭代记录v2", "完成迭代记录v2 并发布", "p6", "CHANGE_RECORD"],
  ["MFA重认证-05", "MFA重认证-05 管理员操作", "p1", "FEATURE"],
  ["CSRF轮换", "CSRF轮换会话保护", "p2", "FEATURE"],
  ["PostgreSQL18迁移", "PostgreSQL18迁移与角色", "p3", "PROJECT"],
  ["合并TASK-GROUP-009", "合并TASK-GROUP-009来源分支", "p4", "TASK_GROUP"],
  ["通知-未读", "通知-未读计数与轮询", "p5", "MODULE"],
  ["动态“项目概览”", "动态“项目概览”时间线", "p6", "MODULE"],
  ["审计-100并发", "审计-100并发链一致", "p1", "MODULE"],
  ["模块CORE", "模块CORE 功能影响", "p2", "MODULE"],
  ["功能-LOGIN", "功能-LOGIN 登录档案", "p3", "FEATURE"],
  ["记录CR-2026-0031", "记录CR-2026-0031版本", "p4", "CHANGE_RECORD"],
  ["遗留问题-0007", "遗留问题-0007转任务", "p5", "TASK"],
  ["恢复-作废记录", "恢复-作废记录状态", "p6", "CHANGE_RECORD"],
  ["草稿-版本2", "草稿-版本2内容保存", "p1", "CHANGE_RECORD"],
  ["GitHub-PR-42", "GitHub-PR-42链接", "p2", "EXTERNAL_LINK"]
];

const punctuationCases: readonly ExpectedTuple[] = [
  ["登录，版本", "登录，版本管理与发布校验", "p1", "CHANGE_RECORD"],
  ["全局搜索：", "全局搜索：项目范围筛选", "p2", "FEATURE"],
  ["项目（POC）", "项目（POC）命名与编号", "p3", "PROJECT"],
  ["任务/记录", "任务/记录关联关系", "p4", "TASK"],
  ["MFA+CSRF", "MFA+CSRF 重认证流程", "p5", "FEATURE"],
  ["未读·通知", "未读·通知计数", "p6", "MODULE"],
  ["审计；100并发", "审计；100并发链一致", "p1", "MODULE"],
  ["恢复——记录", "恢复——记录状态与历史", "p2", "CHANGE_RECORD"],
  ["作废「记录」", "作废「记录」可见性", "p3", "CHANGE_RECORD"],
  ["GitHub_Issue#42", "GitHub_Issue#42 链接审批", "p4", "EXTERNAL_LINK"]
];

const noResultQueries = [
  "qx7-不存在-zz9",
  "不存在词条xq7",
  "%%",
  "__",
  "\\\\",
  "<>?&\"{}",
  "新词不存在-2026"
];

const edgeCases = [
  ...noResultCases("no-result", noResultQueries),
  ...noResultCases("edge", ["a"], "too-short"),
  ...noResultCases("edge", [""], "empty"),
  ...noResultCases("edge", ["x".repeat(300)], "too-long")
];

const goldenInputs: ReadonlyArray<Omit<GoldenQuerySpec, "id">> = [
  ...expectedCases("zh-short", zhShortCases),
  ...expectedCases("code", codeCases),
  ...expectedCases("english", englishCases),
  ...expectedCases("mixed", mixedCases),
  ...expectedCases("punctuation", punctuationCases),
  ...edgeCases
];

export const goldenQueries: readonly GoldenQuerySpec[] =
  goldenInputs.map((entry, index) => ({
    ...entry,
    id: `G${String(index + 1).padStart(3, "0")}`
  }));

export function assertGoldenQueryShape(): number {
  if (goldenQueries.length !== 100) {
    throw new Error(
      `Golden query count must be 100, got ${goldenQueries.length}`
    );
  }

  const ids = new Set<string>();
  for (const [index, entry] of goldenQueries.entries()) {
    const expectedId = `G${String(index + 1).padStart(3, "0")}`;
    if (entry.id !== expectedId || ids.has(entry.id)) {
      throw new Error(`Golden query id mismatch or duplicate: ${entry.id}`);
    }
    ids.add(entry.id);

    if (entry.policy === "normal" && entry.expectedText === null) {
      throw new Error(`${entry.id} must define expected text`);
    }
    if (entry.policy !== "normal" && entry.expectedText !== null) {
      throw new Error(`${entry.id} must not define expected text`);
    }
  }

  const normalCases = goldenQueries.filter(
    (entry) => entry.policy === "normal"
  ).length;
  if (normalCases < 90) {
    throw new Error(`Need at least 90 expected cases, got ${normalCases}`);
  }

  return normalCases;
}
