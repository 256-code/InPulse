import { Inject, Injectable } from "@nestjs/common";
import {
  recordSummaryAssistResponseSchema,
  type RecordSummaryAssistRequest,
  type RecordSummaryAssistResponse,
} from "@inpulse/api-contract";

import { getHeader, type HttpHeaderBag } from "../auth/csrf.http.js";
import { SessionAuthService } from "../auth/session-auth.service.js";
import { ApiHttpError } from "../http/contract-errors.js";
import { AiAssistRuntimeService } from "../modules/document-import/ai-assist-runtime.service.js";
import {
  AiAssistUpstreamError,
  DocumentImportAiAssistClient,
  type AiAssistDraft,
} from "../modules/document-import/ai-assist.client.js";

const RECORD_SUMMARY_ASSIST_SESSION_REQUIRED =
  "RECORD_SUMMARY_ASSIST_SESSION_REQUIRED";

/**
 * ADR-076 迭代总结 AI 改写 HTTP 编排：身份解析走只读短事务，上游调用在事务外
 * 执行（绝不在数据库事务内发起网络请求）。
 *
 * 不查库、不写库：事实正文由前端按当前筛选范围用既有确定性生成器产出后随请求
 * 带上，服务端只把这段文本交给管理员配置的端点改写；因此本接口不产生任何新的
 * 读权限——请求里的正文本来就只有发送者自己能看见，改写结果也只回给发送者本人。
 * 配置解析、失败分类与截断判定全部复用 ADR-067 / ADR-068 的既有设施。
 */
@Injectable()
export class RecordSummaryAssistHttpService {
  constructor(
    @Inject(SessionAuthService)
    private readonly sessions: SessionAuthService,
    @Inject(AiAssistRuntimeService)
    private readonly aiAssistRuntime: AiAssistRuntimeService,
    @Inject(DocumentImportAiAssistClient)
    private readonly aiAssist: DocumentImportAiAssistClient,
  ) {}

  async assist(
    headers: HttpHeaderBag,
    input: RecordSummaryAssistRequest,
  ): Promise<RecordSummaryAssistResponse> {
    const actor = await this.sessions.resolveActor(
      getHeader(headers, "cookie"),
    );
    if (actor === undefined) {
      throw new ApiHttpError(
        401,
        RECORD_SUMMARY_ASSIST_SESSION_REQUIRED,
        "登录状态已失效，请重新登录",
      );
    }
    const resolution = await this.aiAssistRuntime.resolve();
    if (resolution.kind === "DISABLED") {
      throw new ApiHttpError(
        503,
        "AI_ASSIST_DISABLED",
        "AI 辅助转换未启用或配置无效，请管理员在「成员与设置」中配置",
        { reason: resolution.reason },
      );
    }
    let draft: AiAssistDraft;
    try {
      draft = await this.aiAssist.generateSummaryDraft(resolution.config, {
        requirement: input.requirement,
        facts: input.facts,
      });
    } catch (error) {
      if (error instanceof AiAssistUpstreamError) {
        throw new ApiHttpError(
          503,
          "AI_ASSIST_UPSTREAM_FAILED",
          "AI 服务暂时不可用，请稍后重试",
          { reason: error.reason },
        );
      }
      throw error;
    }
    return recordSummaryAssistResponseSchema.parse({
      markdown: draft.markdown,
      model: draft.model,
      truncated: draft.truncated,
    });
  }
}
