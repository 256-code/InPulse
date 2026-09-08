import React, { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  List,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import type { InpulseApiClient, SearchItem } from "@generated/api";
import {
  describeSearchError,
  isValidSearchQuery,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
  useSearchInfiniteQuery,
} from "./search-query";

const { Paragraph, Text, Title } = Typography;

const entityTypeMeta: Readonly<
  Record<
    SearchItem["entityType"],
    { readonly label: string; readonly color: string }
  >
> = {
  PROJECT: { label: "项目", color: "blue" },
  MODULE: { label: "模块", color: "cyan" },
  FEATURE: { label: "功能", color: "geekblue" },
  TASK: { label: "任务", color: "purple" },
  CHANGE_RECORD: { label: "变更记录", color: "orange" },
  EXTERNAL_LINK: { label: "外部链接", color: "green" },
  TASK_GROUP: { label: "任务组", color: "magenta" },
};

export interface SearchPageViewProps {
  readonly initialQuery?: string;
  readonly onSubmit?: (query: string) => void;
  readonly client?: InpulseApiClient;
}

export const SearchPageView: React.FC<SearchPageViewProps> = ({
  initialQuery = "",
  onSubmit,
  client,
}) => {
  const [draft, setDraft] = useState(initialQuery);

  useEffect(() => {
    setDraft(initialQuery);
  }, [initialQuery]);

  const normalizedQuery = initialQuery.trim();
  const queryIsValid = isValidSearchQuery(normalizedQuery);
  const queryIsTooShort =
    normalizedQuery.length > 0 && normalizedQuery.length < SEARCH_MIN_LENGTH;
  const queryIsTooLong = normalizedQuery.length > SEARCH_MAX_LENGTH;

  const {
    data,
    isPending,
    isError,
    error,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useSearchInfiniteQuery({
    query: normalizedQuery,
    ...(client ? { client } : {}),
  });

  const results = data?.pages.flatMap((page) => [...page.items]) ?? [];

  const handleSearch = (value: string) => {
    onSubmit?.(value.trim());
  };

  let content: React.ReactNode;
  if (queryIsTooShort || queryIsTooLong) {
    content = (
      <Alert
        showIcon
        type="warning"
        message={`搜索词需为 ${SEARCH_MIN_LENGTH}～${SEARCH_MAX_LENGTH} 个字符`}
      />
    );
  } else if (normalizedQuery.length === 0) {
    content = (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="输入至少 2 个字符开始全局搜索"
      />
    );
  } else if (isPending) {
    content = (
      <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
        <Spin size="large" description="正在搜索..." />
      </div>
    );
  } else if (isError) {
    content = (
      <Alert showIcon type="error" message={describeSearchError(error)} />
    );
  } else if (results.length === 0) {
    content = (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="未找到匹配结果"
      />
    );
  } else {
    content = (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <List
          dataSource={results}
          rowKey={(item) => `${item.entityType}:${item.entityId}`}
          renderItem={(item) => (
            <List.Item data-testid="search-result-item">
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                <Space align="center" wrap>
                  <Tag color={entityTypeMeta[item.entityType].color}>
                    {entityTypeMeta[item.entityType].label}
                  </Tag>
                  <Text strong>{item.title}</Text>
                </Space>
                <Text type="secondary">{item.summary}</Text>
              </Space>
            </List.Item>
          )}
        />
        {hasNextPage ? (
          <Button
            type="primary"
            ghost
            loading={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            加载更多
          </Button>
        ) : null}
      </Space>
    );
  }

  return (
    <Card style={{ borderRadius: 10 }}>
      <Space direction="vertical" size={20} style={{ width: "100%" }}>
        <Space align="center" wrap>
          <Title level={3} style={{ margin: 0 }}>
            全局搜索
          </Title>
          <Tag color="blue">F-26</Tag>
        </Space>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          搜索当前可访问的项目、模块、功能、任务、变更记录、任务组与外部链接。
        </Paragraph>
        <Input.Search
          aria-label="搜索关键词"
          allowClear
          enterButton="搜索"
          maxLength={SEARCH_MAX_LENGTH}
          placeholder="搜索项目、模块、功能、任务、记录..."
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onSearch={handleSearch}
          style={{ maxWidth: 620 }}
        />
        {queryIsValid ? (
          <Text type="secondary">共找到 {results.length} 条结果</Text>
        ) : null}
        {content}
      </Space>
    </Card>
  );
};
