import React, { useState } from "react";
import { Alert, Button } from "antd";
import type { InpulseApiClient, ProjectDeletionItem } from "@generated/api";
import { AppModal as Modal } from "@features/common/components/AppModal";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import {
  describeProjectManagementError,
  usePurgeProject,
  useRestoreProject,
} from "@features/projects/project-management-query";

export interface ProjectDeletionActionsProps {
  readonly deletion: ProjectDeletionItem;
  readonly client?: InpulseApiClient | undefined;
}

/**
 * ADR-051：在项目动态的删除行右侧、紧邻「原始快照」处提供「还原项目」与
 * 「彻底删除」两个入口。是否渲染由服务端在删除台账里按当前操作者的实时身份
 * 给出的 `canRestore` / `canPurge` 决定（系统管理员或本项目 ACTIVE 组长可还原，
 * 只有系统管理员可彻底删除），这里不自行推断角色，写路径会重新判定。
 *
 * 还原成功后该删除记录消失，父级列表重取即可让整行退出；彻底删除是唯一
 * 不可逆动作，因此走二次确认弹窗。
 */
export const ProjectDeletionActions: React.FC<ProjectDeletionActionsProps> = ({
  deletion,
  client,
}) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const restoreMutation = useRestoreProject(deletion.projectId, client);
  const purgeMutation = usePurgeProject(deletion.projectId, client);

  if (!deletion.canRestore && !deletion.canPurge) {
    return null;
  }

  const busy = restoreMutation.isPending || purgeMutation.isPending;
  const failure =
    restoreMutation.error !== null
      ? describeProjectManagementError(restoreMutation.error, "restore")
      : purgeMutation.error !== null
        ? describeProjectManagementError(purgeMutation.error, "purge")
        : null;

  return (
    <div className="deletion-actions">
      <div className="deletion-buttons">
        {deletion.canRestore ? (
          <button
            type="button"
            className="small-button"
            data-testid={`restore-project-${deletion.projectId}`}
            aria-label={`还原项目 ${deletion.name}`}
            disabled={busy}
            title="还原项目：项目重新出现在列表、搜索与详情里"
            onClick={() => restoreMutation.mutate()}
          >
            <InpulseIcon name="rotateCcw" size={13} />
            还原项目
          </button>
        ) : null}
        {deletion.canPurge ? (
          <button
            type="button"
            className="small-button danger-button"
            data-testid={`purge-project-${deletion.projectId}`}
            aria-label={`彻底删除项目 ${deletion.name}`}
            disabled={busy}
            title="彻底删除：从数据库中物理删除项目及其全部下级数据"
            onClick={() => setConfirmOpen(true)}
          >
            <InpulseIcon name="alert" size={13} />
            彻底删除
          </button>
        ) : null}
      </div>
      {failure === null ? null : (
        <span className="deletion-error" role="alert">
          {failure}
        </span>
      )}
      {deletion.canPurge ? (
        <Modal
          className="catalog-modal"
          open={confirmOpen}
          eyebrow={`${deletion.code} / 彻底删除项目`}
          title="确认彻底删除项目"
          tone="danger"
          icon="alert"
          onCancel={() => {
            if (!purgeMutation.isPending) setConfirmOpen(false);
          }}
          mask={{ closable: !purgeMutation.isPending }}
          footer={
            <>
              <Button
                className="secondary-button"
                disabled={purgeMutation.isPending}
                onClick={() => setConfirmOpen(false)}
              >
                取消
              </Button>
              <Button
                className="primary-button danger-button"
                data-testid={`confirm-purge-project-${deletion.projectId}`}
                loading={purgeMutation.isPending}
                onClick={() => purgeMutation.mutate()}
              >
                确认彻底删除
              </Button>
            </>
          }
        >
          <div className="catalog-form">
            <div className="dialog-form">
              <Alert
                showIcon
                type="error"
                title={`确认彻底删除项目「${deletion.name}」？`}
                description="这会从数据库中物理删除该项目的模块、功能、任务、任务组、迭代记录、遗留项、成员关系、通知、搜索与动态投影，以及该项目自己的审计链，删除后无法还原，项目编码也不会被重新使用。系统级审计只保留一条「彻底删除项目」记录。"
              />
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
};
