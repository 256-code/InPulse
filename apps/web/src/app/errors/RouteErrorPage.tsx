import React from "react";
import { Button, Result } from "antd";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";

/**
 * 路由级错误兜底：替换 React Router 默认的开发者错误页，
 * 避免把英文提示与错误细节暴露给最终用户。
 */
export const RouteErrorPage: React.FC = () => {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div data-testid="route-error-page" style={{ padding: 48 }}>
      <Result
        status={notFound ? "404" : "error"}
        title={notFound ? "页面不存在" : "页面加载失败"}
        subTitle={
          notFound
            ? "地址可能已失效或输入有误。"
            : "页面渲染遇到异常，请重新加载后重试。"
        }
        extra={
          <Button type="primary" onClick={() => window.location.reload()}>
            重新加载页面
          </Button>
        }
      />
    </div>
  );
};

export default RouteErrorPage;
