# syntax=docker/dockerfile:1
#
# 生产 API 镜像（技术设计 v1.2.2 §11.1）。
# builder 固定安装 frozen lockfile 并构建 api-contract/database/api，再通过
# `pnpm deploy --legacy --filter @inpulse/api --prod` 生成仅含生产依赖的独立运行树。
# 所有 `FROM` 均按 ADR-017 固定 `repository:tag@sha256:<64hex>`。
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS builder
WORKDIR /workspace

ENV CI=true
RUN corepack enable

# 先只复制依赖清单再安装，让依赖层不随源码变化失效；`pnpm install
# --frozen-lockfile` 需要所有 workspace 包的 manifest，新增 workspace 包时必须
# 在这里同步补一行，否则安装会因 lockfile 与 manifests 不一致而失败。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY database/package.json database/
COPY apps/api/package.json apps/api/
COPY apps/e2e/package.json apps/e2e/
COPY apps/web/package.json apps/web/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/eslint-config/package.json packages/eslint-config/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @inpulse/api-contract build \
 && pnpm --filter @inpulse/database build \
 && pnpm --filter @inpulse/api build \
 && pnpm deploy --legacy --filter @inpulse/api --prod /out

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /out/package.json ./package.json
COPY --from=builder /out/dist ./dist
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /workspace/deploy/docker/healthcheck.mjs ./healthcheck.mjs

# 官方 Node 镜像自带 npm/corepack，Trivy 会在 runtime 中报告其全局工具链漏洞；
# API 只运行编译后的 Node 入口，不需要任何包管理器，因此从运行时删除。
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
 && chown -R 10001:10001 /app

USER 10001:10001
EXPOSE 3000
CMD ["node", "dist/main.js"]
