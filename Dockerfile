FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/
COPY docs/ ./docs/

RUN mkdir -p /app/data

EXPOSE 3000

ENV PORT=3000

CMD ["node", "server.js"]
