# Production image for the API, the background worker and database migrations.
# Build from the repository root:  docker build -f apps/api/Dockerfile -t ahia-api .
#   API:        docker run … ahia-api                       (default command)
#   Worker:     docker run … ahia-api node dist/worker.js   (set RUN_WORKERS=false on the API)
#   Migrations: docker run … ahia-api npx prisma migrate deploy   (run before each release)
FROM node:24-slim AS build
# Prisma picks its migration engine by OpenSSL version, so build and runtime must match.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace @ahia/api --include-workspace-root --ignore-scripts
COPY apps/api apps/api
RUN npm rebuild @prisma/engines prisma \
  && npm run build -w @ahia/api \
  && npm prune --omit=dev --workspace @ahia/api \
  && mkdir -p apps/api/node_modules

FROM node:24-slim
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts apps/api/
WORKDIR /app/apps/api
# Local uploads only (use S3 in production: STORAGE_PROVIDER=s3).
RUN mkdir -p .data && chown node:node .data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
