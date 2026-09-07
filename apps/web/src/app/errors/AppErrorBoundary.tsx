import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { Result, Button } from "antd";

interface Props {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

interface State {
  readonly hasError: boolean;
  readonly error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 捕获未处理异常，避免整个单页崩溃
    console.error("Uncaught UI error caught by AppErrorBoundary:", error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div data-testid="app-error-boundary" style={{ padding: 48 }}>
          <Result
            status="error"
            title="应用发生意外错误"
            subTitle={this.state.error?.message ?? "页面渲染遇到异常，请重试或刷新页面。"}
            extra={
              <Button type="primary" onClick={this.handleReset}>
                重新加载页面
              </Button>
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}
