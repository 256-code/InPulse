import type { Finding } from "../src/validate.js";

export function reportFindings(
  label: string,
  findings: readonly Finding[],
): number {
  if (findings.length === 0) {
    process.stdout.write(`${label}: 全部检查通过。\n`);
    return 0;
  }
  process.stderr.write(`${label}: 发现 ${findings.length} 个问题\n`);
  for (const finding of findings) {
    process.stderr.write(
      `- [${finding.rule}] ${finding.operationId}: ${finding.message}\n`,
    );
  }
  return 1;
}
