# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 尹绪柏 (Theodore Yin)
#
# 多阶段构建:build 阶段安装依赖并构建全部包,runtime 阶段只含 server 生产依赖与 Web UI 静态文件,以非 root 用户运行。
# 构建:docker build -f docker/Dockerfile -t ai-personal .

ARG NODE_IMAGE=node:24-slim

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm build \
    && pnpm --filter @ai-personal/server deploy --prod --legacy /out

FROM ${NODE_IMAGE} AS runtime
ARG SOURCE_URL=""
ARG VERSION="0.0.0"
LABEL org.opencontainers.image.title="AI-Personal" \
      org.opencontainers.image.description="Self-hostable personal AI assistant framework" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.authors="尹绪柏 (Theodore Yin) <x19169738916@163.com>" \
      org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=384 \
    AIP_HOST=0.0.0.0 \
    AIP_PORT=8787 \
    AIP_WEB_DIR=/app/web \
    AIP_SOURCE_URL=${SOURCE_URL}
WORKDIR /app
COPY --from=build --chown=node:node /out ./
COPY --from=build --chown=node:node /repo/apps/web/dist ./web
COPY --from=build --chown=node:node /repo/LICENSE /repo/NOTICE ./
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
