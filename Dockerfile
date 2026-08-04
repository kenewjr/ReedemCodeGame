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

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/version').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
