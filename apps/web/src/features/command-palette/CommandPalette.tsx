import React, { useEffect, useMemo, useState } from "react";
import type { InpulseApiClient, SearchItem } from "@generated/api";
import {
  InpulseIcon,
  type InpulseIconName,
} from "@features/common/components/InpulseIcon";
import {
  describeSearchError,
  isValidSearchQuery,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
  useSearchInfiniteQuery,
} from "@features/search/search-query";

interface QuickAction {
  readonly key: string;
  readonly group: string;
  readonly icon: InpulseIconName;
  readonly title: string;
  readonly hint: string;
  readonly run: () => void;
}

interface SearchResult {
  readonly key: string;
  readonly group: string;
  readonly icon: InpulseIconName;
  readonly title: string;
  readonly hint: string;
  readonly run: () => void;
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly client?: InpulseApiClient;
  readonly onClose: () => void;
  readonly onNavigate: (path: string) => void;
  readonly onOpenSearch: (query: string) => void;
}

const PALETTE_GROUP_ORDER = [
  "项目",
  "模块",
  "功能",
  "任务",
  "迭代记录",
  "任务组",
  "外部链接",
  "操作",
  "搜索",
] as const;

const paletteGroupOrder: readonly string[] = PALETTE_GROUP_ORDER;

const entityMeta: Readonly<
  Record<SearchItem["entityType"], { label: string; icon: InpulseIconName }>
> = {
  PROJECT: { label: "项目", icon: "folder" },
  MODULE: { label: "模块", icon: "boxes" },
  FEATURE: { label: "功能", icon: "code" },
  TASK: { label: "任务", icon: "clipboard" },
  CHANGE_RECORD: { label: "迭代记录", icon: "gitBranch" },
  EXTERNAL_LINK: { label: "外部链接", icon: "code" },
  TASK_GROUP: { label: "任务组", icon: "boxes" },
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  client,
  onClose,
  onNavigate,
  onOpenSearch,
}) => {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const normalizedQuery = query.trim();
  const canSearch = isValidSearchQuery(normalizedQuery);
  const search = useSearchInfiniteQuery({
    query: normalizedQuery,
    ...(client ? { client } : {}),
    limit: 20,
  });

  const quickActions: QuickAction[] = useMemo(
    () => [
      {
        key: "quick-projects",
        group: "操作",
        icon: "folder",
        title: "打开项目与功能",
        hint: "新建项目或查看刚创建的项目动态",
        run: () => onNavigate("/projects"),
      },
      {
        key: "quick-tasks",
        group: "操作",
        icon: "clipboard",
        title: "打开任务中心",
        hint: "跨项目任务列表入口",
        run: () => onNavigate("/tasks"),
      },
      {
        key: "quick-records",
        group: "操作",
        icon: "gitBranch",
        title: "打开迭代记录",
        hint: "已发生变化的业务历史入口",
        run: () => onNavigate("/records"),
      },
      {
        key: "quick-notifications",
        group: "操作",
        icon: "bell",
        title: "打开通知中心",
        hint: "查看全部站内通知",
        run: () => onNavigate("/notifications"),
      },
      {
        key: "quick-settings",
        group: "操作",
        icon: "settings",
        title: "打开成员与设置",
        hint: "成员、角色与权限入口",
        run: () => onNavigate("/settings"),
      },
    ],
    [onNavigate],
  );

  const searchResults = useMemo<SearchResult[]>(() => {
    if (!canSearch) {
      return [];
    }
    const items = search.data?.pages.flatMap((page) => [...page.items]) ?? [];
    return items.map((item) => {
      const meta = entityMeta[item.entityType];
      return {
        key: `${item.entityType}:${item.entityId}`,
        group: meta.label,
        icon: meta.icon,
        title: item.title,
        hint: `${meta.label} · ${item.summary || "可访问对象"}`,
        run: () => onOpenSearch(normalizedQuery),
      };
    });
  }, [canSearch, normalizedQuery, onOpenSearch, search.data]);

  const searchQuickAction: SearchResult[] = canSearch
    ? [
        {
          key: "search-query",
          group: "搜索",
          icon: "search",
          title: `搜索“${normalizedQuery}”`,
          hint: "在全局搜索页查看完整权限过滤结果",
          run: () => onOpenSearch(normalizedQuery),
        },
      ]
    : [];

  const results = useMemo(
    () => [...quickActions, ...searchQuickAction, ...searchResults],
    [quickActions, searchQuickAction, searchResults],
  );
  const flatResults = results;

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [normalizedQuery, searchResults.length]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const grouped = new Map<string, SearchResult[]>();
  for (const result of results) {
    grouped.set(result.group, [...(grouped.get(result.group) ?? []), result]);
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => (current + 1) % Math.max(flatResults.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor(
        (current) =>
          (current - 1 + flatResults.length) % Math.max(flatResults.length, 1),
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const current = flatResults[cursor];
      if (current) {
        current.run();
        onClose();
      }
    }
  };

  const orderedGroups = [...grouped.entries()].sort(([a], [b]) => {
    const rank = (name: string) => {
      const index = paletteGroupOrder.indexOf(name);
      return index === -1 ? PALETTE_GROUP_ORDER.length : index;
    };
    return rank(a) - rank(b);
  });

  const searchHint = !canSearch
    ? normalizedQuery.length === 0
      ? "输入关键词开始搜索，或直接选择一个快捷操作。"
      : `请输入 ${SEARCH_MIN_LENGTH}～${SEARCH_MAX_LENGTH} 个字符进行搜索。`
    : search.isError
      ? describeSearchError(search.error)
      : search.isPending
        ? "正在通过服务端搜索当前可访问对象..."
        : `支持中文短词、完整英文缩写、完整代码标识符与完整编号；不保证英文或任意子串搜索。已找到 ${searchResults.length} 条可访问结果。`;

  return (
    <div
      className="overlay palette-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="palette"
        role="dialog"
        aria-label="全局搜索"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="palette-input">
          <InpulseIcon name="search" size={17} />
          <input
            autoFocus
            value={query}
            maxLength={SEARCH_MAX_LENGTH}
            placeholder="搜索项目、模块、功能、任务、迭代记录…"
            aria-label="全局搜索关键词"
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd>Esc</kbd>
        </div>
        <p className="palette-hint">{searchHint}</p>
        <div className="palette-results">
          {flatResults.length > 0 ? (
            orderedGroups.map(([group, items]) => (
              <section key={group}>
                <h4>{group}</h4>
                <ul>
                  {items.map((result) => {
                    const index = results.indexOf(result);
                    return (
                      <li key={result.key}>
                        <button
                          type="button"
                          className={index === cursor ? "cursor" : ""}
                          onMouseEnter={() => setCursor(index)}
                          onClick={() => {
                            result.run();
                            onClose();
                          }}
                        >
                          <InpulseIcon name={result.icon} size={15} />
                          <span>
                            <strong>{result.title}</strong>
                            <small>{result.hint}</small>
                          </span>
                          {index === cursor ? (
                            <InpulseIcon name="cornerDown" size={14} />
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          ) : (
            <div className="calm-empty palette-empty">
              <InpulseIcon name="search" size={24} />
              <strong>没有匹配结果</strong>
              <p>没有可通过当前账号访问的匹配对象。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
