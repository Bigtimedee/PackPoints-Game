# Use official Node 20 image
FROM node:20.18-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg

# Set production environment
ENV NODE_ENV=production

# Set working directory
WORKDIR /app

# Cache-bust: 2026-04-15
LABEL build-date="2026-04-15"

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production=false

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Expose port
EXPOSE 5000

# Make startup script executable
RUN chmod +x /app/start.sh

# Run as non-root user for security
RUN addgroup -S packpts && adduser -S packpts -G packpts
USER packpts

# Health check using the existing /health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-5000}/health || exit 1

# Start the application
CMD ["/bin/sh", "/app/start.sh"]
