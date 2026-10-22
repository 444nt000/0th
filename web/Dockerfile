FROM node:26.10.0-slim AS build

ARG PNPM_VERSION=11.13.1
RUN npm install -g pnpm@${PNPM_VERSION}

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
COPY sdk/package.json sdk/
COPY circuits/package.json circuits/
RUN pnpm install --frozen-lockfile --filter web...

COPY sdk/ sdk/
COPY web/ web/
COPY circuits/target/login.json circuits/target/vk circuits/target/

ARG VITE_RPC_URL
ARG VITE_SERVER_URL
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_ADMIN
ARG VITE_REGISTRY
ARG VITE_VERIFIER
ARG VITE_ACCOUNT_CLASS_HASH
RUN pnpm --filter web run build

FROM caddy:2.10-alpine

COPY web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/web/dist /srv
