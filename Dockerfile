FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/

# Create required directories
RUN mkdir -p logs uploads/complaints

EXPOSE 3000

USER node

CMD ["node", "src/server.js"]
