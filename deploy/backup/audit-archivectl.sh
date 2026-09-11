#!/usr/bin/env bash
#
# InPulse 审计归档宿主控制器（技术设计 v1.2.2 §11.5 第 7 步、F-08 步骤 6）。
#
# 本脚本只负责宿主层：go-live 启用门禁、每小时链头检查点、每日加密明细导出、
# 并发锁与失败告警。归档实现（链头检查点、AES-256-GCM 明细导出、WORM PUT）
# 由 compose operations profile 的 audit-archive 服务承担（apps/ops）；本脚本
# 不接触归档签名密钥与 WORM 凭据。
#
# 子命令：
#   enable [--confirm-go-live]  安装并启用宿主调度（上线门禁动作）
#   disable                     停止并移除宿主调度
#   run-checkpoint              写入一次签名链头检查点（每小时调度调用）
#   run-export                  导出前一 UTC 自然日（每日调度调用）
#   status                      打印配置、调度与最近成功时间
#
# 红线（技术设计 §11.5）：归档凭据只允许新建对象、不能覆盖或删除；上线前
# 不部署、不运行定时归档任务。

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

ENV_FILE="${INPULSE_AUDIT_ARCHIVE_ENV_FILE:-/etc/inpulse/audit-archive.env}"
UNIT_SOURCE_DIR="$SCRIPT_DIR"
UNIT_DIR="${INPULSE_AUDIT_ARCHIVE_UNIT_DIR:-/etc/systemd/system}"
LIB_DIR="${INPULSE_AUDIT_ARCHIVE_LIB_DIR:-/usr/local/lib/inpulse}"
LOCK_FILE="${INPULSE_AUDIT_ARCHIVE_LOCK_FILE:-/run/lock/inpulse-audit-archive.lock}"

# 安装与卸载使用的固定单元清单：不含通配符，避免误删宿主其它单元。
UNITS=(
  inpulse-audit-archive-checkpoint.service
  inpulse-audit-archive-checkpoint.timer
  inpulse-audit-archive-export.service
  inpulse-audit-archive-export.timer
)

log() { printf '[inpulse-audit-archive] %s\n' "$*" >&2; }
die() { printf '[inpulse-audit-archive] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
用法：audit-archivectl.sh <子命令>

  enable [--confirm-go-live]
      校验 compose 已交付 operations/audit-archive 服务后安装并启用宿主调度。
  disable
      停止并移除宿主调度；不改动 WORM 中的任何归档对象。
  run-checkpoint
      写入一次签名链头检查点到 WORM（每小时调度调用）。
  run-export
      导出前一 UTC 自然日的加密审计明细与签名清单（每日调度调用）。
  status
      打印配置、服务交付状态与最近成功时间。
USAGE
}

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    set -a
    . "$ENV_FILE"
    set +a
  fi
  STATE_DIR="${INPULSE_AUDIT_ARCHIVE_STATE_DIR:-/var/lib/inpulse-audit-archive}"
  CHECKPOINT_STAMP="$STATE_DIR/last-checkpoint"
  EXPORT_STAMP="$STATE_DIR/last-export"
  ENABLED_STAMP="$STATE_DIR/enabled-at"
  COMPOSE_FILE="${INPULSE_COMPOSE_FILE:-/srv/inpulse/deploy/compose.yaml}"
  COMPOSE_ENV_FILE="${INPULSE_COMPOSE_ENV_FILE:-/srv/inpulse/deploy/.env.deploy}"
  COMPOSE_PROJECT="${INPULSE_COMPOSE_PROJECT:-inpulse}"
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "需要 root 执行（安装 systemd 单元、写入受限状态目录）"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

compose() {
  docker compose \
    --project-name "$COMPOSE_PROJECT" \
    --env-file "$COMPOSE_ENV_FILE" \
    --file "$COMPOSE_FILE" "$@"
}

require_compose_files() {
  [[ -f "$COMPOSE_FILE" ]] || die "缺少 compose 文件：$COMPOSE_FILE"
  [[ -f "$COMPOSE_ENV_FILE" ]] || die "缺少镜像 ref 环境文件：$COMPOSE_ENV_FILE"
}

audit_archive_service_delivered() {
  require_compose_files
  compose --profile operations config --services 2>/dev/null | grep -Fxq 'audit-archive'
}

run_archive() {
  local subcommand="$1"

  load_env
  require_root
  require_cmd docker
  require_cmd flock
  require_compose_files
  mkdir -p "$STATE_DIR"
  local stamp
  case "$subcommand" in
    checkpoint) stamp="$CHECKPOINT_STAMP" ;;
    export) stamp="$EXPORT_STAMP" ;;
    *) die "未知归档子命令：$subcommand" ;;
  esac

  # 并发锁：同一时间只允许一个归档任务；与上一次重叠时跳过而不是排队。
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log "已有归档任务在运行（锁 $LOCK_FILE），跳过本次触发"
    exit 0
  fi

  audit_archive_service_delivered \
    || die "compose 尚未交付 operations/audit-archive 服务；上线门禁前不得启用调度"

  local started
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log "开始审计归档（$subcommand）：$started"
  # 归档镜像不设 ENTRYPOINT：run 的附加参数即完整命令（node dist/cli.js <cmd>）。
  # 失败告警只由单元的 OnFailure 触发（同时覆盖超时与被杀路径），避免重复发送。
  compose --profile operations run --rm -T audit-archive node dist/cli.js "$subcommand" \
    || die "审计归档（$subcommand）失败：$started（失败告警由 OnFailure 单元上报）"
  touch "$stamp"
  log "审计归档（$subcommand）完成：$stamp"
}

cmd_enable() {
  local confirm=""
  while (( $# > 0 )); do
    case "$1" in
      --confirm-go-live) confirm=1; shift ;;
      *) usage; exit 2 ;;
    esac
  done

  load_env
  require_root
  require_cmd systemctl
  require_cmd docker
  require_cmd sed
  [[ -n "$confirm" ]] \
    || die "启用宿主审计归档调度属于生产上线动作：确认 go-live 后使用 --confirm-go-live"
  [[ -f "$ENV_FILE" ]] || die "缺少宿主配置 $ENV_FILE（参考 deploy/backup/audit-archive.env.example）"
  require_compose_files
  audit_archive_service_delivered \
    || die "compose 尚未交付 operations/audit-archive 服务；不得提前启用调度"

  # 记录启用时间：首次检查点出现前的运维基线。
  install -d -m 0750 "$STATE_DIR"
  date -u +%s >"$ENABLED_STAMP"

  install -d -m 0755 "$LIB_DIR"
  install -m 0755 "$UNIT_SOURCE_DIR/audit-archivectl.sh" "$LIB_DIR/audit-archivectl.sh"

  local unit
  for unit in "${UNITS[@]}"; do
    [[ -f "$UNIT_SOURCE_DIR/$unit" ]] || die "缺少单元文件：$unit"
    install -m 0644 "$UNIT_SOURCE_DIR/$unit" "$UNIT_DIR/$unit"
    sed -i "s|__INPULSE_AUDIT_ARCHIVECTL__|$LIB_DIR/audit-archivectl.sh|g" "$UNIT_DIR/$unit"
  done

  systemctl daemon-reload
  systemctl enable --now \
    inpulse-audit-archive-checkpoint.timer \
    inpulse-audit-archive-export.timer

  log "宿主审计归档调度已启用：每小时检查点 + 每日导出"
  log "如需立即验证，运行 $LIB_DIR/audit-archivectl.sh run-checkpoint 并检查 WORM 前缀"
}

cmd_disable() {
  load_env
  require_root
  require_cmd systemctl
  systemctl disable --now \
    inpulse-audit-archive-checkpoint.timer \
    inpulse-audit-archive-export.timer 2>/dev/null || true
  local unit
  for unit in "${UNITS[@]}"; do
    rm -f -- "$UNIT_DIR/$unit"
  done
  systemctl daemon-reload
  log "宿主审计归档调度已停用并移除；WORM 对象与状态目录 $STATE_DIR 未改动"
}

cmd_status() {
  load_env
  printf '配置文件：%s\n' "$ENV_FILE"
  printf 'compose：%s（env %s，project %s）\n' "$COMPOSE_FILE" "$COMPOSE_ENV_FILE" "$COMPOSE_PROJECT"
  printf '调度：每小时检查点 + 每日导出（UTC 00:20）\n'
  if [[ -f "$CHECKPOINT_STAMP" ]]; then
    printf '最近检查点：%s\n' "$(stat -c '%y' "$CHECKPOINT_STAMP")"
  elif [[ -f "$ENABLED_STAMP" ]]; then
    printf '最近检查点：无记录（启用时间 %s）\n' "$(stat -c '%y' "$ENABLED_STAMP")"
  else
    printf '最近检查点：无记录\n'
  fi
  if [[ -f "$EXPORT_STAMP" ]]; then
    printf '最近导出：%s\n' "$(stat -c '%y' "$EXPORT_STAMP")"
  else
    printf '最近导出：无记录\n'
  fi
  if command -v systemctl >/dev/null 2>&1; then
    printf 'checkpoint timer：%s\n' "$(systemctl is-active inpulse-audit-archive-checkpoint.timer 2>/dev/null || true)"
    printf 'export timer：%s\n' "$(systemctl is-active inpulse-audit-archive-export.timer 2>/dev/null || true)"
  fi
  if audit_archive_service_delivered; then
    printf 'operations/audit-archive 服务：已交付\n'
  else
    printf 'operations/audit-archive 服务：未交付，此刻不得启用调度\n'
  fi
}

main() {
  local command_name="${1:-}"
  if [[ -n "$command_name" ]]; then
    shift
  fi
  case "$command_name" in
    enable) cmd_enable "$@" ;;
    disable) cmd_disable "$@" ;;
    run-checkpoint) run_archive checkpoint ;;
    run-export) run_archive export ;;
    status) cmd_status "$@" ;;
    help|-h|--help|"") usage ;;
    *) usage; exit 2 ;;
  esac
}

main "$@"
