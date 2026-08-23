import dotenv from 'dotenv';
dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name}. Смотрите .env.example`);
  }
  return value;
}

const webappUrlRaw = (process.env.WEBAPP_URL ?? '').trim();

export const config = {
  botToken: required('BOT_TOKEN'),
  // Не обязателен на старте: пока не известен публичный HTTPS-домен
  // (например, только разворачиваетесь на bothost и ждёте домен),
  // бот должен запускаться и работать, просто без кнопки Mini App.
  webappUrl: webappUrlRaw.startsWith('https://') ? webappUrlRaw : undefined,
  port: Number(process.env.PORT ?? 3000),
  adminIds: (process.env.ADMIN_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),
  dbPath: process.env.DB_PATH ?? './data/poputka74.db',
  cities: ['Челябинск', 'Кунашак'] as const,
};

export type City = (typeof config.cities)[number];
