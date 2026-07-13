FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/

RUN mkdir -p logs

EXPOSE 3000

USER node

CMD ["npm", "start"]