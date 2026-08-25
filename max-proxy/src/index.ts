import http from 'http';
import httpProxy from 'http-proxy';

/**
 * Лёгкий обратный прокси без БД и бизнес-логики. Разворачивается отдельным
 * проектом на РФ-регионе bothost — так у него российский IP, и MAX-клиенты
 * достают Mini App без VPN. Просто форвардит все запросы (включая
 * multipart-загрузку фото и все /api/*) на основной сервер в Нидерландах;
 * сам сервер и БД остаются одни, ничего не дублируется.
 */

const PORT = Number(process.env.PORT ?? 3000);

const upstreamUrlRaw = (process.env.UPSTREAM_URL ?? '').trim();
if (!upstreamUrlRaw.startsWith('https://')) {
  throw new Error(
    'Не задана переменная окружения UPSTREAM_URL — адрес основного сервера ' +
      '(например, https://bot1234.bothost.tech), должна начинаться с https://'
  );
}
// Без завершающего слэша, чтобы не задваивать его при форварде req.url (который уже начинается с "/").
const UPSTREAM_URL = upstreamUrlRaw.replace(/\/$/, '');

const proxy = httpProxy.createProxyServer({
  target: UPSTREAM_URL,
  changeOrigin: true,
  secure: true,
  xfwd: true,
});

proxy.on('error', (err, _req, res) => {
  console.error('Ошибка проксирования запроса:', err);
  const httpRes = res as http.ServerResponse;
  if (!httpRes.headersSent) {
    httpRes.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  httpRes.end('Bad Gateway — не удалось связаться с основным сервером');
});

const server = http.createServer((req, res) => {
  // Отдельный путь для проверки, что сам прокси жив, не завязан на upstream —
  // удобно для диагностики "прокси не отвечает" против "не отвечает основной сервер".
  if (req.url === '/_proxy/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, upstream: UPSTREAM_URL }));
    return;
  }
  proxy.web(req, res);
});

server.listen(PORT, () => {
  console.log(`Прокси запущен на порту ${PORT}, форвардит запросы на ${UPSTREAM_URL}`);
});
