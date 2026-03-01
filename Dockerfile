# Use official Node 20 image
FROM node:20-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg

# Set working directory
WORKDIR /app

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

# Start the application
CMD ["/bin/sh", "/app/start.sh"]
