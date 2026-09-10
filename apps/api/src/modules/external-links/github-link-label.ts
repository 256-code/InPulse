import { normalizeGitHubUrl } from "./github-url.js";
export function githubLinkLabel(url: string) {
  const value = normalizeGitHubUrl(url);
  const segments = new URL(value.normalizedUrl).pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  const releaseTag =
    segments[2] === "releases" && segments[3] === "tag" && segments.length >= 5
      ? segments.slice(4).join("/")
      : null;
  const label =
    value.kind === "ISSUE"
      ? "Issue #" + value.externalNumber
      : value.kind === "PULL_REQUEST"
        ? "PR #" + value.externalNumber
        : value.kind === "COMMIT"
          ? "Commit " + value.externalSha!.slice(0, 12)
          : releaseTag
            ? "Release " + releaseTag
            : (value.repository ?? "GitHub");
  return { label: label.slice(0, 500), releaseTag };
}
