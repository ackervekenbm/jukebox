# Build stage
FROM node:22-alpine AS build
WORKDIR /app
ARG COMMIT_SHA
ARG BUILD_TIME
ARG GITHUB_REPOSITORY
COPY package.json package-lock.json ./
# No dependency install script is needed to compile the client/server, and
# skipping them keeps npm's legacy implicit `node-gyp rebuild` (triggered by
# better-sqlite3's binding.gyp) out of this stage.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

# Serve stage
FROM node:22-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
# The runtime needs a loadable better-sqlite3 binary. From v13 on it ships musl
# prebuilds, but npm still also runs its legacy implicit `node-gyp rebuild`
# (binding.gyp without an install script, upstream issue #1516), so a toolchain
# has to be present. It is removed again in the same layer.
RUN apk add --no-cache --virtual .build-deps python3 build-base \
 && npm ci --omit=dev --no-audit --no-fund \
 && apk del .build-deps
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "dist-server/index.js"]
