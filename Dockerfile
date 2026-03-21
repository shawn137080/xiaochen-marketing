FROM node:22-slim

# Install sharp dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source
COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./
COPY prisma.config.ts ./

# Generate Prisma client
RUN npx prisma generate

# Data directory (DB + images mounted as volume)
RUN mkdir -p /data/images

EXPOSE 3100

# Start dashboard + daemon together via a simple wrapper
CMD ["node", "--import", "tsx", "src/entrypoint.ts"]
