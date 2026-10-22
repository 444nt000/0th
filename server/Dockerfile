FROM node:26.10.0-slim

ARG PNPM_VERSION=11.13.1
RUN npm install -g pnpm@${PNPM_VERSION}

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
RUN pnpm install --frozen-lockfile --filter server

COPY server/ server/

USER node

CMD ["node", "server/src/main.ts"]
