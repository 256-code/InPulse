# syntax=docker/dockerfile:1
#
# 生产 ops 镜像（技术设计 v1.2.2 §11.1 的 migration/ops 运行镜像之一，§11.2 的
# operations profile 载体）：承载一次性任务 `backup`（F-10.3：pg_dump + AEAD
# 加密 + 签名清单 + 异机上传）与 `audit-archive`（F-08 步骤 6），不承载 API。
# builder 与 API/migration 镜像同 commit 构建；runtime 仅保留编译产物、生产依赖
# 与 PostgreSQL 18 客户端（pg_dump/pg_restore 供备份与恢复演练），非 root 运行。
#
# 与技术设计 §11.1 “migration/ops image” 的关系：§11.2 为迁移与 ops 分别使用
# MIGRATE_IMAGE_REF 与 OPS_IMAGE_REF 两个 ref，本文件只产出 ops 侧镜像；迁移
# 镜像保持 deploy/docker/migration.Dockerfile 不变，避免给迁移任务引入
# PostgreSQL 客户端。发布清单为两个 ref 分别解析到同一 commit 构建出的
# 迁移镜像与 ops 镜像。
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS builder
WORKDIR /workspace

ENV CI=true
RUN corepack enable

# 与 API/迁移镜像同构：依赖清单先复制，安装层不随源码变化失效；新增 workspace
# 包时必须同步补充这里的 manifest 行。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY database/package.json database/
COPY apps/api/package.json apps/api/
COPY apps/e2e/package.json apps/e2e/
COPY apps/ops/package.json apps/ops/
COPY apps/web/package.json apps/web/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/canonical-json/package.json packages/canonical-json/
COPY packages/eslint-config/package.json packages/eslint-config/

RUN pnpm install --frozen-lockfile

COPY . .

# `--config.node-linker=hoisted`：默认（isolated）的 legacy deploy 会把 workspace
# 包以符号链接指向 /workspace，runtime 阶段不存在该目录，镜像内模块解析会失败；
# hoisted 布局把全部依赖（含 workspace 包）复制进 /out，运行树完全自包含。
RUN pnpm --filter @inpulse/canonical-json build \
 && pnpm --filter @inpulse/database build \
 && pnpm --filter @inpulse/ops build \
 && pnpm deploy --legacy --filter @inpulse/ops --prod --config.node-linker=hoisted /out

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime
ENV NODE_ENV=production
WORKDIR /app

# PostgreSQL 18 客户端：备份必须用与生产同补丁的 pg_dump（§11.5 步骤 1），
# 恢复演练用同包 pg_restore。PGDG 源与版本号固定，与 db-bootstrap 镜像同一
# 基线；postgresql-common 自带 PGDG keyring，脚本离线启用源。
# postgresql-common 依赖 ssl-cert，其 postinst 生成 Debian 公共占位私钥
# /etc/ssl/private/ssl-cert-snakeoil.key；Trivy 镜像门禁把该公开占位 key 判为
# HIGH secret 并使 CI 失败，而 ops 只运行 pg_dump 客户端与 Node，不需要任何
# 本机 TLS 服务端证书，因此删除占位 key/pem 与其悬空的 CA 哈希链接。
ARG PGDG_CLIENT_VERSION=18.6-1.pgdg12+2
RUN apt-get update \
 && apt-get install -y -V ca-certificates lsb-release wget postgresql-common \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get update \
 && apt-get install -y -V postgresql-client-18=${PGDG_CLIENT_VERSION} \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /etc/ssl/private/ssl-cert-snakeoil.key /etc/ssl/certs/ssl-cert-snakeoil.pem \
 && find /etc/ssl/certs -maxdepth 1 -xtype l -delete

COPY --from=builder /out/package.json ./package.json
COPY --from=builder /out/dist ./dist
COPY --from=builder /out/node_modules ./node_modules

# 官方 Node 镜像自带 npm/corepack，Trivy 会在 runtime 中报告其全局工具链漏洞；
# ops 只运行编译后的 Node 入口，不需要任何包管理器，因此从运行时删除。
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

RUN groupadd --gid 10002 ops \
 && useradd --uid 10002 --gid 10002 --no-create-home --shell /usr/sbin/nologin ops \
 && chown -R 10002:10002 /app \
 && install -d -o 10002 -g 10002 -m 0755 /backup

USER 10002:10002
CMD ["node", "dist/backup-cli.js", "backup"]
