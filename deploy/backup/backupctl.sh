#!/usr/bin/env bash
#
# InPulse 备份调度宿主控制器（技术设计 v1.2.2 §11.5 / ADR-020）。
#
# 本脚本只负责宿主层：go-live 启用门禁、12 小时调度、并发锁、失败与 staleness
# 告警。备份实现本身（pg_dump、AEAD/age 加密、SHA-256 与签名清单、异机上传与
# 保留）由 compose 的 operations `backup` 服务承担（F-10.3）；本脚本不接触明文
# 备份内容，也不读取加密密钥。
#
# 子命令：
#   enable [--confirm-go-live] [--drill-evidence <path>]  安装并启用宿主调度
#   disable                                               停止并移除宿主调度
#   run                                                   执行一次备份（systemd 调用）
#   check-staleness                                       超过阈值无成功记录即告警
#   alert <subject>                                       发送告警（OnFailure 调用）
#   status                                                打印调度与最近成功状态
#
# 红线（技术设计 §11.5 / ADR-020）：备份必须加密、必须异机存放，且至少有一份
# 通过完整恢复演练的证据；上线前不部署、不运行定时备份任务。

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

ENV_FILE="${INPULSE_BACKUP_ENV_FILE:-/etc/inpulse/backup.env}"
UNIT_SOURCE_DIR="$SCRIPT_DIR"
UNIT_DIR="${INPULSE_BACKUP_UNIT_DIR:-/etc/systemd/system}"
LIB_DIR="${INPULSE_BACKUP_LIB_DIR:-/usr/local/lib/inpulse}"
LOCK_FILE="${INPULSE_BACKUP_LOCK_FILE:-/run/lock/inpulse-backup.lock}"

# 安装与卸载使用的固定单元清单：不含通配符，避免误删宿主其它单元。
UNITS=(
  inpulse-backup.service
  inpulse-backup.timer
  inpulse-backup-alert@.service
  inpulse-backup-watchdog.service
  inpulse-backup-watchdog.timer
)

log() { printf '[inpulse-backup] %s\n' "$*" >&2; }
die() { printf '[inpulse-backup] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
用法：backupctl.sh <子命令>

  enable [--confirm-go-live] [--drill-evidence <path>]
      校验 go-live 前置并安装/启用宿主调度。缺少 --confirm-go-live 或恢复演练
      证据时拒绝执行；compose 尚未交付 operations/backup 服务（F-10.3）时同样拒绝。
  disable
      停止并移除宿主调度；不改动任何备份文件与状态目录。
  run
      执行一次备份（并发锁 + docker compose --profile operations run --rm backup）。
  check-staleness
      超过 INPULSE_BACKUP_MAX_AGE_HOURS 没有成功记录即告警。
  alert <subject>
      发送告警；Webhook 只从 INPULSE_BACKUP_ALERT_WEBHOOK_FILE 读取。
  status
      打印配置、阈值、最近成功时间与 timer 状态。
USAGE
}

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    set -a
    . "$ENV_FILE"
    set +a
  fi
  STATE_DIR="${INPULSE_BACKUP_STATE_DIR:-/var/lib/inpulse-backup}"
  SUCCESS_STAMP="$STATE_DIR/last-success"
  ALERT_STAMP="$STATE_DIR/last-alert"
  ENABLED_STAMP="$STATE_DIR/enabled-at"
  COMPOSE_FILE="${INPULSE_COMPOSE_FILE:-/srv/inpulse/deploy/compose.yaml}"
  COMPOSE_ENV_FILE="${INPULSE_COMPOSE_ENV_FILE:-/srv/inpulse/deploy/.env.deploy}"
  COMPOSE_PROJECT="${INPULSE_COMPOSE_PROJECT:-inpulse}"
  MAX_AGE_HOURS="${INPULSE_BACKUP_MAX_AGE_HOURS:-18}"
  REPEAT_HOURS="${INPULSE_BACKUP_ALERT_REPEAT_HOURS:-6}"
  WEBHOOK_FILE="${INPULSE_BACKUP_ALERT_WEBHOOK_FILE:-/etc/inpulse/secrets/backup-alert-webhook}"
  DRILL_EVIDENCE="${INPULSE_BACKUP_DRILL_EVIDENCE:-/etc/inpulse/backup-drill-evidence}"
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "需要 root 执行（安装 systemd 单元、读取受限告警文件）"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

require_private_file() {
  local path="$1" label="$2" mode owner
  [[ -s "$path" ]] || die "$label 不存在或为空：$path"
  mode="$(stat -c '%a' "$path")"
  owner="$(stat -c '%U' "$path")"
  case "$mode" in
    400|600) ;;
    *) die "$label 权限必须是 0400 或 0600，当前为 $mode：$path" ;;
  esac
  [[ "$owner" == "root" ]] || die "$label 属主必须是 root，当前为 $owner：$path"
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

backup_service_delivered() {
  require_compose_files
  compose --profile operations config --services 2>/dev/null | grep -Fxq 'backup'
}

send_alert() {
  local subject="$1" body="$2" payload
  if [[ ! -s "$WEBHOOK_FILE" ]]; then
    log "告警接收方文件缺失或为空：$WEBHOOK_FILE（告警未发送）"
    return 1
  fi
  command -v curl >/dev/null 2>&1 || { log "缺少 curl，告警未发送"; return 1; }
  payload="$(printf '{"source":"inpulse-backup","host":"%s","subject":"%s","body":"%s","at":"%s"}' \
    "$(hostname)" "$subject" "$body" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
  # Webhook 只从受限文件读取，并通过 curl --config - 从 stdin 传入，
  # 避免地址出现在进程参数或日志里。
  if printf 'url = "%s"\n' "$(cat "$WEBHOOK_FILE")" \
    | curl --silent --show-error --fail --max-time 20 --config - \
        --header 'Content-Type: application/json' --data-binary "$payload" >/dev/null; then
    log "告警已发送：$subject"
    return 0
  fi
  log "告警发送失败：$subject"
  return 1
}

cmd_run() {
  load_env
  require_root
  require_cmd docker
  require_cmd flock
  require_compose_files
  mkdir -p "$STATE_DIR"

  # 并发锁：同一时间只允许一个备份任务；与上一次重叠时跳过而不是排队。
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log "已有备份任务在运行（锁 $LOCK_FILE），跳过本次触发"
    exit 0
  fi

  backup_service_delivered \
    || die "compose 尚未交付 operations/backup 服务（F-10.3）；上线门禁前不得启用调度"

  local started
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log "开始备份：$started"
  # 失败告警只由单元的 OnFailure 触发（同时覆盖超时与被杀路径），避免重复发送。
  compose --profile operations run --rm -T backup \
    || die "备份任务失败：$started（失败告警由 OnFailure 单元上报）"
  touch "$SUCCESS_STAMP"
  log "备份完成；成功时间已记录到 $SUCCESS_STAMP"
}

cmd_check_staleness() {
  load_env
  require_root
  mkdir -p "$STATE_DIR"

  local now age_seconds age_hours
  now="$(date -u +%s)"
  if [[ -f "$SUCCESS_STAMP" ]]; then
    age_seconds=$(( now - $(stat -c '%Y' "$SUCCESS_STAMP") ))
  elif [[ -f "$ENABLED_STAMP" ]]; then
    # 首次备份尚未完成：以启用时间为基线，刚启用时不误报 staleness。
    age_seconds=$(( now - $(stat -c '%Y' "$ENABLED_STAMP") ))
  else
    age_seconds=$(( MAX_AGE_HOURS * 3600 + 1 ))
  fi
  age_hours=$(( age_seconds / 3600 ))

  if (( age_seconds <= MAX_AGE_HOURS * 3600 )); then
    log "最近成功备份在 ${age_hours} 小时前，未超过 ${MAX_AGE_HOURS} 小时阈值"
    return 0
  fi

  if [[ -f "$ALERT_STAMP" ]]; then
    local since_alert=$(( now - $(stat -c '%Y' "$ALERT_STAMP") ))
    if (( since_alert < REPEAT_HOURS * 3600 )); then
      log "已告警（$(( since_alert / 3600 )) 小时前），未到重复告警间隔 ${REPEAT_HOURS} 小时"
      # 退出 0：本小时的告警职责已完成（节流中），不再触发 OnFailure 重复告警。
      exit 0
    fi
  fi

  if send_alert "备份超过 ${MAX_AGE_HOURS} 小时未成功" "最近成功记录为 ${age_hours} 小时前，请按 Runbook 检查宿主调度与备份任务。"; then
    touch "$ALERT_STAMP"
    exit 0
  fi
  log "告警发送失败；由 OnFailure 告警单元与 systemd 失败状态暴露"
  exit 1
}

cmd_alert() {
  load_env
  local subject="${1:-未知来源}"
  send_alert "备份告警：$subject" "来源 $subject 触发失败通知；处理步骤见 docs/runbooks/backup-restore.md。" \
    || exit 1
}

cmd_enable() {
  local confirm="" evidence=""
  while (( $# > 0 )); do
    case "$1" in
      --confirm-go-live) confirm=1; shift ;;
      --drill-evidence)
        [[ -n "${2:-}" ]] || die "--drill-evidence 需要文件路径"
        evidence="$2"; shift 2 ;;
      *) usage; exit 2 ;;
    esac
  done

  load_env
  require_root
  require_cmd systemctl
  require_cmd docker
  require_cmd sed
  [[ -n "$confirm" ]] \
    || die "启用宿主备份调度属于生产上线动作：完成全新主机恢复演练后使用 --confirm-go-live"
  [[ -f "$ENV_FILE" ]] || die "缺少宿主配置 $ENV_FILE（参考 deploy/backup/backup.env.example）"
  [[ -n "$evidence" ]] || evidence="$DRILL_EVIDENCE"
  [[ -s "$evidence" ]] \
    || die "缺少全新主机恢复演练证据：$evidence（红线：只有通过完整恢复演练的文件才是有效备份）"
  require_private_file "$WEBHOOK_FILE" "告警接收方文件"
  require_compose_files
  backup_service_delivered \
    || die "compose 尚未交付 operations/backup 服务（F-10.3），不得提前启用调度"

  # 记录启用时间：首次成功备份出现前，watchdog 以它为 staleness 基线。
  install -d -m 0750 "$STATE_DIR"
  date -u +%s >"$ENABLED_STAMP"

  install -d -m 0755 "$LIB_DIR"
  install -m 0755 "$UNIT_SOURCE_DIR/backupctl.sh" "$LIB_DIR/backupctl.sh"

  local unit
  for unit in "${UNITS[@]}"; do
    [[ -f "$UNIT_SOURCE_DIR/$unit" ]] || die "缺少单元文件：$unit"
    install -m 0644 "$UNIT_SOURCE_DIR/$unit" "$UNIT_DIR/$unit"
    sed -i "s|__INPULSE_BACKUPCTL__|$LIB_DIR/backupctl.sh|g" "$UNIT_DIR/$unit"
  done

  systemctl daemon-reload
  systemctl enable --now inpulse-backup.timer inpulse-backup-watchdog.timer

  log "宿主调度已启用：inpulse-backup.timer（每 12 小时）、inpulse-backup-watchdog.timer（每小时 staleness）"
  log "首次备份由 timer 触发；如需立即验证，先运行 $LIB_DIR/backupctl.sh run 并确认异机副本可解密读取"
}

cmd_disable() {
  load_env
  require_root
  require_cmd systemctl
  systemctl disable --now inpulse-backup.timer inpulse-backup-watchdog.timer 2>/dev/null || true
  local unit
  for unit in "${UNITS[@]}"; do
    rm -f -- "$UNIT_DIR/$unit"
  done
  systemctl daemon-reload
  log "宿主备份调度已停用并移除；备份文件与状态目录 $STATE_DIR 未改动"
}

cmd_status() {
  load_env
  printf '配置文件：%s\n' "$ENV_FILE"
  printf 'compose：%s（env %s，project %s）\n' "$COMPOSE_FILE" "$COMPOSE_ENV_FILE" "$COMPOSE_PROJECT"
  printf '阈值：%s 小时无成功备份即告警；重复告警间隔 %s 小时\n' "$MAX_AGE_HOURS" "$REPEAT_HOURS"
  printf '保留：本机 %s 天 / 异机 %s 天\n' \
    "${INPULSE_BACKUP_LOCAL_RETENTION_DAYS:-7}" "${INPULSE_BACKUP_REMOTE_RETENTION_DAYS:-30}"
  if [[ -f "$SUCCESS_STAMP" ]]; then
    printf '最近成功：%s\n' "$(stat -c '%y' "$SUCCESS_STAMP")"
  elif [[ -f "$ENABLED_STAMP" ]]; then
    printf '最近成功：无记录（staleness 基线为启用时间 %s）\n' "$(stat -c '%y' "$ENABLED_STAMP")"
  else
    printf '最近成功：无记录\n'
  fi
  if command -v systemctl >/dev/null 2>&1; then
    printf 'inpulse-backup.timer：%s\n' "$(systemctl is-active inpulse-backup.timer 2>/dev/null || true)"
  fi
  if backup_service_delivered; then
    printf 'operations/backup 服务：已交付\n'
  else
    printf 'operations/backup 服务：未交付（F-10.3），此刻不得启用调度\n'
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
    run) cmd_run "$@" ;;
    check-staleness) cmd_check_staleness "$@" ;;
    alert) cmd_alert "$@" ;;
    status) cmd_status "$@" ;;
    help|-h|--help|"") usage ;;
    *) usage; exit 2 ;;
  esac
}

main "$@"