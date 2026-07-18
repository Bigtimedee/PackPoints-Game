# Use official Node 20 image
FROM node:20.18-alpine

# Install FFmpeg + su-exec (privilege drop in start.sh after chowning the volume mount)
RUN apk add --no-cache ffmpeg su-exec

# Set production environment
ENV NODE_ENV=production

# Set working directory
WORKDIR /app

# Cache-bust: 2026-05-14T20:00
LABEL build-date="2026-05-14T20:00"

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

# Pre-download Tesseract language data at build time (avoids runtime network + permission issues)
RUN node -e "const {createWorker}=require('tesseract.js');createWorker('eng',1,{logger:()=>{}}).then(w=>w.terminate()).catch(()=>{})" || true

# Run as non-root user for security (must happen before chown so the user exists)
RUN addgroup -S packpts && adduser -S packpts -G packpts

# Create runtime data directory with correct ownership
RUN mkdir -p /app/data/masked-cards && \
    chown -R packpts:packpts /app/data

# NOTE: no USER directive — Railway mounts the volume at /app/data/masked-cards
# owned by root, so start.sh boots as root, chowns the mount, then drops to
# packpts via su-exec. The app process itself never runs as root.

# Health check using the existing /health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-5000}/health || exit 1

# Start the application
CMD ["/bin/sh", "/app/start.sh"]
