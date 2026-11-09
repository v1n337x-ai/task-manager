# syntax=docker/dockerfile:1

FROM node:20.11-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20.11-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG DATABASE_URL=postgresql://build:build@localhost:5432/task_manager?schema=public
ARG AUTH_SECRET=build-only-secret
ARG APPLICATION_SECRET=build-only-secret
RUN DATABASE_URL="$DATABASE_URL" AUTH_SECRET="$AUTH_SECRET" APPLICATION_SECRET="$APPLICATION_SECRET" npm run build

FROM node:20.11-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3210
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.ts ./
EXPOSE 3210
USER nextjs
CMD ["npm", "start"]
