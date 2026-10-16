import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Input, Space } from "antd";
import { AppModal as Modal } from "@features/common/components/AppModal";
import { CalmSkeleton } from "@features/common/components/CalmSkeleton";
import {
  type AdminUserItem,
  type InpulseApiClient,
  type OrganizationItem,
} from "@generated/api";
import {
  organizationErrorMessage,
  useOrganizationMutations,
  useOrganizations,
  type OrganizationChange,
} from "./organization-query";

export interface OrganizationManagerModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly members: readonly AdminUserItem[];
  readonly client?: InpulseApiClient | undefined;
  readonly onChanged: (message: string) => void;
}

/**
 * ADR-081 组织管理弹窗：新建 / 改名 / 删除组织，按组织查看成员数并批量拉人。
 * 成员数从成员列表聚合（listAdminUsers 结果），不新增接口。
 */
export const OrganizationManagerModal: React.FC<
  OrganizationManagerModalProps
> = ({ open, onClose, members, client, onChanged }) => {
  const organizations = useOrganizations(client, { enabled: open });
  const mutation = useOrganizationMutations(client);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(
    null,
  );
  const [removing, setRemoving] = useState<OrganizationItem | null>(null);
  const [pulling, setPulling] = useState<OrganizationItem | null>(null);
  const [pullSelection, setPullSelection] = useState<readonly number[]>([]);

  useEffect(() => {
    if (!open) {
      setNewName("");
      setRenaming(null);
      setRemoving(null);
      setPulling(null);
      setPullSelection([]);
      mutation.reset();
    }
  }, [open]);

  const countOf = (organizationId: number) =>
    members.filter((member) => member.organizationId === organizationId).length;
  const nameOf = (organizationId: number) =>
    organizations.data?.items.find((item) => item.id === organizationId)
      ?.name ?? "组织 " + organizationId;

  const candidates = useMemo(
    () =>
      pulling === null
        ? []
        : members.filter((member) => member.organizationId !== pulling.id),
    [members, pulling],
  );

  const submit = async (change: OrganizationChange, successText: string) => {
    try {
      await mutation.mutateAsync(change);
      setNewName("");
      setRenaming(null);
      setRemoving(null);
      setPulling(null);
      setPullSelection([]);
      onChanged(successText);
    } catch {
      // 失败详情由 mutation.error 统一渲染。
    }
  };

  const submitAssign = async () => {
    if (pulling === null || pullSelection.length === 0) {
      onChanged("请先选择要加入该组织的成员");
      return;
    }
    await submit(
      {
        action: "assign",
        userIds: pullSelection,
        organizationId: pulling.id,
      },
      "已把 " + pullSelection.length + " 名成员加入「" + pulling.name + "」",
    );
  };

  return (
    <Modal
      className="catalog-modal"
      open={open}
      eyebrow="成员分组"
      title={pulling === null ? "组织管理" : "拉人进入「" + pulling.name + "」"}
      body
      onCancel={onClose}
      mask={{ closable: !mutation.isPending }}
    >
      {mutation.isError ? (
        <Alert
          type="error"
          title={organizationErrorMessage(mutation.error)}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {pulling === null ? (
        <>
          <p>
            组织用于把成员分组；一名成员同一时间至多属于一个组织，未分配不影响项目权限。
          </p>
          {organizations.isPending ? (
            <CalmSkeleton
              variant="list"
              rows={3}
              compact
              label="正在加载组织"
            />
          ) : organizations.isError ? (
            <p role="alert">
              {organizationErrorMessage(organizations.error)}{" "}
              <button onClick={() => void organizations.refetch()}>重试</button>
            </p>
          ) : organizations.data.items.length === 0 ? (
            <p>还没有组织，先在下方创建第一个组织。</p>
          ) : (
            <div className="member-list">
              {organizations.data.items.map((organization) => (
                <div className="member-row" key={organization.id}>
                  <div className="member-id">
                    {renaming !== null && renaming.id === organization.id ? (
                      <Space.Compact style={{ width: "100%" }}>
                        <Input
                          aria-label={"组织新名称 " + organization.name}
                          value={renaming.name}
                          maxLength={100}
                          onChange={(event) =>
                            setRenaming({
                              id: organization.id,
                              name: event.target.value,
                            })
                          }
                        />
                        <Button
                          type="primary"
                          loading={mutation.isPending}
                          onClick={() =>
                            void submit(
                              {
                                action: "rename",
                                organization,
                                name: renaming.name.trim(),
                              },
                              "组织名称已更新",
                            )
                          }
                        >
                          保存
                        </Button>
                        <Button onClick={() => setRenaming(null)}>取消</Button>
                      </Space.Compact>
                    ) : (
                      <strong>{organization.name}</strong>
                    )}
                    <small>
                      {countOf(organization.id) + " 名成员"} ·{" "}
                      {members
                        .filter(
                          (member) => member.organizationId === organization.id,
                        )
                        .slice(0, 6)
                        .map((member) => member.name)
                        .join("、") || "暂无成员"}
                    </small>
                  </div>
                  <div className="member-actions">
                    <Button
                      className="text-button"
                      onClick={() =>
                        setRenaming({
                          id: organization.id,
                          name: organization.name,
                        })
                      }
                    >
                      改名
                    </Button>
                    <Button
                      className="text-button"
                      onClick={() => {
                        setPulling(organization);
                        setPullSelection([]);
                      }}
                    >
                      拉人
                    </Button>
                    <Button
                      className="text-button"
                      onClick={() => setRemoving(organization)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {removing !== null ? (
            <div className="permission-note" role="alert">
              <span>
                删除「{removing.name}」后，{countOf(removing.id)}{" "}
                名成员将变为未分配， 该操作立即生效。确定删除吗？
              </span>
              <Space>
                <Button onClick={() => setRemoving(null)}>取消</Button>
                <Button
                  danger
                  type="primary"
                  loading={mutation.isPending}
                  onClick={() =>
                    void submit(
                      { action: "delete", organization: removing },
                      "组织「" + removing.name + "」已删除",
                    )
                  }
                >
                  确认删除
                </Button>
              </Space>
            </div>
          ) : null}

          <Space style={{ marginTop: 16 }} wrap>
            <Input
              aria-label="新组织名称"
              placeholder="新组织名称"
              value={newName}
              maxLength={100}
              style={{ width: 220 }}
              onChange={(event) => setNewName(event.target.value)}
            />
            <Button
              type="primary"
              loading={mutation.isPending}
              disabled={newName.trim().length === 0}
              onClick={() =>
                void submit(
                  { action: "create", name: newName.trim() },
                  "组织已创建",
                )
              }
            >
              新建组织
            </Button>
          </Space>
        </>
      ) : (
        <>
          <p>
            选择要加入「{pulling.name}
            」的成员（已属于其他组织的成员会一并调整归属）。
          </p>
          {candidates.length === 0 ? (
            <p>所有成员都已在该组织内。</p>
          ) : (
            <div className="member-list">
              {candidates.map((member) => (
                <div className="member-row" key={member.id}>
                  <Checkbox
                    aria-label={"选择 " + member.name}
                    checked={pullSelection.includes(member.id)}
                    onChange={(event) =>
                      setPullSelection((current) =>
                        event.target.checked
                          ? [...current, member.id]
                          : current.filter((id) => id !== member.id),
                      )
                    }
                  />
                  <div className="member-id">
                    <strong>{member.name}</strong>
                    <small>
                      {member.organizationId === null
                        ? "未分配"
                        : "当前：" + nameOf(member.organizationId)}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Space style={{ marginTop: 16 }}>
            <Button
              className="secondary-button"
              onClick={() => setPulling(null)}
              disabled={mutation.isPending}
            >
              返回
            </Button>
            <Button
              type="primary"
              loading={mutation.isPending}
              disabled={pullSelection.length === 0}
              onClick={() => void submitAssign()}
            >
              加入所选 {pullSelection.length} 人
            </Button>
          </Space>
        </>
      )}
    </Modal>
  );
};
