# syntax=docker/dockerfile:1
# Multi-stage build for the Next.js standalone runtime.
# Resulting image : ~150-200 MB on alpine.

FROM node:22-alpine AS deps
WORKDIR /app
# `.npmrc` doit être copié AVEC le package.json sinon ses flags
# (notamment `legacy-peer-deps=true` pour les peer deps non-React-19 de
# @visx/* 3.12) ne sont pas pris en compte par `npm ci`.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Standalone output : self-contained server.js + only the prod node_modules
# we actually need.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
