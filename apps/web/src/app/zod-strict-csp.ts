/**
 * ADR-021 严格 CSP 的启动加固（ADR-067 批次发现）：给 zod v4 写入 `jitless`。
 *
 * zod v4 的对象 Schema JIT 变体在构造时会用 `Function("")` 探测 eval 是否可用，
 * 可用时再用 `new Function(...)` 编译解析器。E2E 实测（ADR-067 pdf 用例）：
 * 在逐响应 nonce、不含 `unsafe-eval` 的 CSP 下，探测抛出的 EvalError 会被 zod
 * 静默捕获、功能自动回退到非 JIT 实现，但浏览器仍记录一条
 * `securitypolicyviolation`（script-src 阻止 eval）并进入生产上报（Google 的
 * 零违规断言会判红）。`jitless` 是 zod 官方开关（探测入口自身会先检查它）：
 * 显式打开后完全不调用 `Function(...)`，运行行为与「探测失败后的回退」一致。
 *
 * 这里刻意不 import zod：zod 只在懒加载的项目表单 chunk 里使用，提前 import 会把
 * 整个 zod 拉进入口 bundle。直接写入 zod 自身的全局配置对象正是 `z.config()` 的
 * 实现方式（`globalThis.__zod_globalConfig`，zod v4 core 会复用已有对象）。
 * zod 若变更该通道，`zod-strict-csp.test.ts` 与 E2E「零 CSP 违规」断言会立即报红。
 *
 * 必须最先求值：由 `main.tsx` 的第一个 import 保证，早于任何 zod Schema 构造。
 */

interface ZodGlobalConfig {
  jitless?: boolean | undefined;
}

const host = globalThis as { __zod_globalConfig?: ZodGlobalConfig | undefined };
host.__zod_globalConfig ??= {};
host.__zod_globalConfig.jitless = true;
