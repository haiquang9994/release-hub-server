# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output and static assets
COPY --from=builder /app/dist ./dist
COPY public/ ./public/

# Create persistent data directories
RUN mkdir -p /app/uploads /app/data

# Use a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app
USER appuser

EXPOSE 4000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
