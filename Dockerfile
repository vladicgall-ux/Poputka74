FROM node:20-bookworm-slim

# python3/make/g++ — на случай, если для better-sqlite3 не найдётся готовый
# бинарник под конкретную платформу сборки и потребуется компиляция из исходников.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/index.js"]
