/** 从仓库地址里取出 owner/repo 短标识；不是「主机 + 两段路径」时回退为原地址。 */
export function repositoryDisplayPath(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(Boolean);
    if (segments.length >= 2)
      return (segments[0] + "/" + segments[1]).replace(/\.git$/, "");
  } catch {
    // 非法地址按原样展示，与后端 normalizedUrl 口径保持弱耦合。
  }
  return url;
}
