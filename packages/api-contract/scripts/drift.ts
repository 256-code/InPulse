import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  clientArtifactDirectory,
  openApiArtifactPath,
  readArtifact,
  readCommittedFingerprints,
  renderArtifacts,
  repositoryRoot,
} from "../src/artifacts.js";

const fingerprints = await readCommittedFingerprints();
const artifacts = renderArtifacts(fingerprints);
const problems: string[] = [];

for (const artifact of artifacts) {
  const committed = await readArtifact(artifact.path);
  if (committed === undefined) {
    problems.push(
      `${artifact.path}: 生成物缺失，运行 pnpm contract:generate 后提交`,
    );
    continue;
  }
  if (committed !== artifact.content) {
    problems.push(
      `${artifact.path}: 与 Schema/Route Registry 的生成结果不一致（禁止手工修改生成物）`,
    );
  }
}

const expected = new Set(artifacts.map((artifact) => artifact.path));
for (const directory of [
  resolve(repositoryRoot, openApiArtifactPath, ".."),
  resolve(repositoryRoot, clientArtifactDirectory),
]) {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (entry === ".gitkeep") {
      continue;
    }
    const relativePath = resolve(directory, entry)
      .slice(repositoryRoot.length + 1)
      .split("\\")
      .join("/");
    if (!expected.has(relativePath)) {
      problems.push(`${relativePath}: 生成目录中存在未由生成器产出的文件`);
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`契约生成物漂移检查失败：\n`);
  for (const problem of problems) {
    process.stderr.write(`- ${problem}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `契约生成物漂移检查通过：${artifacts.length} 个产物与 Registry 一致。\n`,
  );
}
