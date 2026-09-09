# syntax=docker/dockerfile:1
#
# 生产 migration/ops 镜像（技术设计 v1.2.2 §11.1）。
# 与 API 同 commit 构建，runtime 仅保留迁移所需生产依赖并运行编译后的迁移入口。
# 迁移 SQL 被复制到 `dist/migrations`，与编译后 `dist/src/migrate.js` 的
# `../migrations` 相对路径一致，因而无需在运行时保留 tsx。
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS builder
WORKDIR /workspace

ENV CI=true
RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile \
 && pnpm --filter @inpulse/database build \
 && pnpm deploy --legacy --filter @inpulse/database --prod /out

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /out/package.json ./package.json
COPY --from=builder /out/dist ./dist
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /out/migrations ./dist/migrations

# 官方 Node 镜像自带 npm/corepack，Trivy 会在 runtime 中报告其全局工具链漏洞；
# Migration 只运行编译后的 Node 入口，不需要任何包管理器，因此从运行时删除。
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
 && chown -R 10001:10001 /app

USER 10001:10001
CMD ["node", "dist/src/migrate.js"]
