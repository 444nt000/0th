FROM node:26.10.0-slim

ARG PNPM_VERSION=11.13.1
RUN npm install -g pnpm@${PNPM_VERSION}

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY registry/package.json registry/
RUN pnpm install --frozen-lockfile --filter registry

COPY registry/ registry/

USER node

CMD ["node", "registry/src/sync.ts"]
