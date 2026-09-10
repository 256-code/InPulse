# syntax=docker/dockerfile:1
#
# 生产 Web 镜像（技术设计 v1.2.2 §11.1）。
# builder 执行 Vite 生产构建；runtime 使用 nginx-unprivileged（固定 1.30.4 digest），
# 监听 8080/8443，静态托管 dist 并将 API/健康检查反向代理到 `api` 服务。
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS builder
WORKDIR /workspace

ENV CI=true
RUN corepack enable

# 与 API 镜像同构：依赖清单先复制，安装层不随源码变化失效；新增 workspace 包时
# 必须同步补充这里的 manifest 行。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY database/package.json database/
COPY apps/api/package.json apps/api/
COPY apps/e2e/package.json apps/e2e/
COPY apps/web/package.json apps/web/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/eslint-config/package.json packages/eslint-config/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @inpulse/web build

FROM nginxinc/nginx-unprivileged:1.30.4@sha256:cb92301e719d6639028de775fe8b28e15f58343aca5e5372001311958aafb300 AS runtime

# nginx-unprivileged 镜像默认已以 UID/GID 101 启动。只有 root 才能写
# /var/lib/apt/lists/partial，因此安装 curl 前临时切回 root，装完再恢复非 root。
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/docker/nginx-security-headers.conf /etc/nginx/snippets/inpulse-security-headers.conf
COPY --from=builder /workspace/apps/web/dist /usr/share/nginx/html

USER 101:101
EXPOSE 8080 8443
