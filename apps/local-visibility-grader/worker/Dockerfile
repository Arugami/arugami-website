# Use Node.js 20 LTS
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production --legacy-peer-deps

# Copy source code
COPY src/ ./src/

# Expose port (not really needed for worker but good practice)
EXPOSE 3000

# Start the worker
CMD ["npm", "start"]
