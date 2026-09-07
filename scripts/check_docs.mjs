#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_REAL = realpathSync(ROOT);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const EXTERNAL_SCHEMES = new Set(["http", "https", "mailto"]);
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;
const ATX_HEADING = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const REFERENCE_DEFINITION = /^ {0,3}\[([^\]]+)\]:[ \t]*(.*)$/;
const EXPLICIT_ANCHOR =
  /<(?:a|[A-Za-z][\w:-]*)\b[^>]*(?:id|name)=["']([^"']+)["'][^>]*>/gi;
const INLINE_CODE = /(`+)(.*?)\1/g;

const errors = [];

function git(args, { input, encoding = "utf8" } = {}) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding,
    input,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function runGitWhitespaceCheck(label, args) {
  const result = git(args);
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    errors.push(`${label}: ${output || `git exited with ${result.status}`}`);
  }
}

function nulSeparatedGitFiles(args) {
  const result = git(args, { encoding: null });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.toString("utf8") || `git ${args.join(" ")} failed`,
    );
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((name) => path.resolve(ROOT, name));
}

function repositoryMarkdownFiles() {
  return nulSeparatedGitFiles([
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]).filter((file) => {
    if (!MARKDOWN_EXTENSIONS.has(path.extname(file).toLowerCase()))
      return false;
    let entry;
    try {
      entry = lstatSync(file);
    } catch {
      return false;
    }
    if (entry.isSymbolicLink()) {
      errors.push(
        `${relative(file)}: Markdown source must not be a symbolic link`,
      );
      return false;
    }
    const realFile = realpathSync(file);
    if (isOutsideRepository(realFile)) {
      errors.push(
        `${relative(file)}: Markdown source resolves outside the repository`,
      );
      return false;
    }
    return statSync(realFile).isFile();
  });
}

function repositoryUntrackedFiles() {
  return nulSeparatedGitFiles([
    "ls-files",
    "-z",
    "--others",
    "--exclude-standard",
  ]).filter(existsSync);
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function isOutsideRepository(file) {
  const relativeFile = path.relative(ROOT_REAL, file);
  return (
    relativeFile === ".." ||
    relativeFile.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeFile)
  );
}

function checkUntrackedWhitespace(files) {
  for (const file of files) {
    const entry = lstatSync(file);
    if (entry.isSymbolicLink() || !entry.isFile()) continue;
    const realFile = realpathSync(file);
    if (isOutsideRepository(realFile)) {
      errors.push(
        `${relative(file)}: untracked file resolves outside the repository`,
      );
      continue;
    }
    const buffer = readFileSync(file);
    if (buffer.includes(0)) continue;
    const lines = buffer.toString("utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].replace(/\r$/, "");
      if (/[ \t]+$/.test(line)) {
        errors.push(`${relative(file)}:${index + 1}: trailing whitespace`);
      }
      if (/^ +\t/.test(line)) {
        errors.push(
          `${relative(file)}:${index + 1}: space before tab in indentation`,
        );
      }
      if (/^(?:<<<<<<<|=======|>>>>>>>)(?: |$)/.test(line)) {
        errors.push(
          `${relative(file)}:${index + 1}: unresolved conflict marker`,
        );
      }
    }
  }
}

function removeHtmlComments(line, state) {
  let output = "";
  let cursor = 0;
  while (cursor < line.length) {
    if (state.inComment) {
      const end = line.indexOf("-->", cursor);
      if (end < 0) return output;
      cursor = end + 3;
      state.inComment = false;
      continue;
    }
    const start = line.indexOf("<!--", cursor);
    if (start < 0) return output + line.slice(cursor);
    output += line.slice(cursor, start);
    cursor = start + 4;
    state.inComment = true;
  }
  return output;
}

function decodeHtml(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, value) =>
      String.fromCodePoint(Number.parseInt(value, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, value) =>
      String.fromCodePoint(Number.parseInt(value, 10)),
    )
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function githubSlug(heading) {
  const cleaned = decodeHtml(
    heading
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(INLINE_CODE, "$2")
      .replace(/\\(.)/g, "$1")
      .trim()
      .toLowerCase(),
  );
  return [...cleaned]
    .filter((character) => /[\p{L}\p{M}\p{N}_\-\s]/u.test(character))
    .map((character) => (/\s/u.test(character) ? "-" : character))
    .join("");
}

function normalizeReference(label) {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function extractDestination(text, start) {
  let cursor = start;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  if (cursor >= text.length) return [null, cursor];
  if (text[cursor] === "<") {
    const end = text.indexOf(">", cursor + 1);
    return end < 0
      ? [null, text.length]
      : [text.slice(cursor + 1, end), end + 1];
  }

  let destination = "";
  let depth = 0;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character === "\\" && cursor + 1 < text.length) {
      destination += text[cursor + 1];
      cursor += 2;
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") {
      if (depth === 0) break;
      depth -= 1;
    } else if (/\s/.test(character) && depth === 0) break;
    destination += character;
    cursor += 1;
  }
  return [destination, cursor];
}

function inlineDestinations(line) {
  const withoutCode = line.replace(INLINE_CODE, (match) =>
    " ".repeat(match.length),
  );
  const found = [];
  let cursor = 0;
  while (true) {
    const marker = withoutCode.indexOf("](", cursor);
    if (marker < 0) break;
    if (marker === 0 || withoutCode[marker - 1] !== "\\") {
      const [destination, end] = extractDestination(withoutCode, marker + 2);
      if (destination) found.push(destination);
      cursor = Math.max(end, marker + 2);
    } else {
      cursor = marker + 2;
    }
  }
  return found;
}

function parseMarkdown(file) {
  const anchors = new Set();
  const slugCounts = new Map();
  const links = [];
  const definitions = new Map();
  const referenceUses = [];
  const state = { inComment: false, fenceCharacter: null, fenceLength: 0 };
  const lines = readFileSync(file, "utf8").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = removeHtmlComments(lines[index], state);
    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (state.fenceCharacter === null) {
        state.fenceCharacter = marker[0];
        state.fenceLength = marker.length;
      } else if (
        marker[0] === state.fenceCharacter &&
        marker.length >= state.fenceLength
      ) {
        state.fenceCharacter = null;
        state.fenceLength = 0;
      }
      continue;
    }
    if (state.fenceCharacter !== null) continue;

    for (const match of line.matchAll(EXPLICIT_ANCHOR)) anchors.add(match[1]);

    const headingMatch = line.match(ATX_HEADING);
    if (headingMatch) {
      const base = githubSlug(headingMatch[1]);
      if (base) {
        const duplicate = slugCounts.get(base) ?? 0;
        anchors.add(duplicate === 0 ? base : `${base}-${duplicate}`);
        slugCounts.set(base, duplicate + 1);
      }
    }

    const withoutCode = line.replace(INLINE_CODE, (match) =>
      " ".repeat(match.length),
    );
    const definitionMatch = withoutCode.match(REFERENCE_DEFINITION);
    if (definitionMatch) {
      const [destination] = extractDestination(definitionMatch[2], 0);
      const id = normalizeReference(definitionMatch[1]);
      if (definitions.has(id))
        errors.push(
          `${relative(file)}:${lineNumber}: duplicate reference definition: ${id}`,
        );
      definitions.set(id, destination);
      if (destination) links.push({ lineNumber, destination });
      continue;
    }

    for (const destination of inlineDestinations(withoutCode))
      links.push({ lineNumber, destination });
    for (const match of withoutCode.matchAll(/!?\[([^\]]+)\]\[([^\]]*)\]/g)) {
      referenceUses.push({
        lineNumber,
        id: normalizeReference(match[2] || match[1]),
      });
    }
  }

  for (const use of referenceUses) {
    if (!definitions.has(use.id))
      errors.push(
        `${relative(file)}:${use.lineNumber}: undefined reference link: ${use.id}`,
      );
  }
  return { anchors, links };
}

function safelyDecode(value, source, lineNumber) {
  try {
    return decodeURIComponent(value);
  } catch {
    errors.push(
      `${relative(source)}:${lineNumber}: malformed URL encoding: ${value}`,
    );
    return null;
  }
}

function validateDestination(source, lineNumber, destination, parsed) {
  const scheme = destination.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  if (scheme) {
    if (!EXTERNAL_SCHEMES.has(scheme[1].toLowerCase())) {
      errors.push(
        `${relative(source)}:${lineNumber}: disallowed link scheme: ${destination}`,
      );
    }
    return;
  }
  if (destination.startsWith("//")) {
    errors.push(
      `${relative(source)}:${lineNumber}: scheme-relative links are not allowed: ${destination}`,
    );
    return;
  }

  const hashAt = destination.indexOf("#");
  const beforeFragment =
    hashAt < 0 ? destination : destination.slice(0, hashAt);
  const rawFragment = hashAt < 0 ? "" : destination.slice(hashAt + 1);
  const queryAt = beforeFragment.indexOf("?");
  const rawPath =
    queryAt < 0 ? beforeFragment : beforeFragment.slice(0, queryAt);

  if (
    WINDOWS_ABSOLUTE.test(rawPath) ||
    rawPath.startsWith("/") ||
    rawPath.startsWith("\\")
  ) {
    errors.push(
      `${relative(source)}:${lineNumber}: local link must be repository-relative: ${destination}`,
    );
    return;
  }

  const decodedPath = safelyDecode(rawPath, source, lineNumber);
  if (decodedPath === null) return;
  const target = rawPath
    ? path.resolve(path.dirname(source), decodedPath)
    : source;
  const relativeTarget = path.relative(ROOT, target);
  if (
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  ) {
    errors.push(
      `${relative(source)}:${lineNumber}: link escapes repository: ${destination}`,
    );
    return;
  }
  if (!existsSync(target)) {
    errors.push(
      `${relative(source)}:${lineNumber}: target does not exist: ${destination}`,
    );
    return;
  }

  const realTarget = realpathSync(target);
  if (isOutsideRepository(realTarget)) {
    errors.push(
      `${relative(source)}:${lineNumber}: link resolves outside repository: ${destination}`,
    );
    return;
  }

  if (!rawFragment) return;
  if (statSync(realTarget).isDirectory()) {
    errors.push(
      `${relative(source)}:${lineNumber}: cannot check anchor on directory: ${destination}`,
    );
    return;
  }
  if (!MARKDOWN_EXTENSIONS.has(path.extname(realTarget).toLowerCase())) {
    errors.push(
      `${relative(source)}:${lineNumber}: anchor target is not Markdown: ${destination}`,
    );
    return;
  }
  const fragment = safelyDecode(rawFragment, source, lineNumber);
  if (fragment === null) return;
  const targetDocument =
    parsed.get(path.resolve(realTarget)) ?? parseMarkdown(realTarget);
  parsed.set(path.resolve(realTarget), targetDocument);
  if (!targetDocument.anchors.has(fragment)) {
    errors.push(
      `${relative(source)}:${lineNumber}: heading anchor does not exist: ${destination}`,
    );
  }
}

function main() {
  const emptyTreeResult = git(["hash-object", "-t", "tree", "--stdin"], {
    input: "",
  });
  if (emptyTreeResult.status !== 0)
    throw new Error(emptyTreeResult.stderr || "cannot create empty tree hash");
  const emptyTree = emptyTreeResult.stdout.trim();

  runGitWhitespaceCheck("committed tree whitespace", [
    "diff",
    "--check",
    emptyTree,
    "HEAD",
  ]);
  runGitWhitespaceCheck("staged whitespace", ["diff", "--cached", "--check"]);
  runGitWhitespaceCheck("unstaged whitespace", ["diff", "--check"]);
  checkUntrackedWhitespace(repositoryUntrackedFiles());

  const markdownFiles = repositoryMarkdownFiles();
  const parsed = new Map(
    markdownFiles.map((file) => [path.resolve(file), parseMarkdown(file)]),
  );
  for (const source of markdownFiles) {
    for (const { lineNumber, destination } of parsed.get(path.resolve(source))
      .links) {
      validateDestination(source, lineNumber, destination, parsed);
    }
  }

  if (errors.length > 0) {
    console.error("Documentation validation failed:");
    for (const error of [...new Set(errors)].sort())
      console.error(`- ${error}`);
    return 1;
  }
  console.log(
    `Checked Git whitespace state and ${markdownFiles.length} Markdown files: links and anchors are valid.`,
  );
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(
    `Documentation validation failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
