import express from 'express';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { usersRouter } from './routes/users';
import { ridesRouter } from './routes/rides';
import { bookingsRouter } from './routes/bookings';
import { adminRouter } from './routes/admin';
import { supportRouter } from './routes/support';
import { ratingsRouter } from './routes/ratings';
import { authRouter } from './routes/auth';
import { uploadsDir } from './middleware/upload';
import { getBotUsername } from '../bot/notifier';
import { config } from '../config';
import { db } from '../db/db';

export function createApp() {
  const app = express();

  // Сколько обратных прокси стоит перед приложением — берётся из
  // TRUST_PROXY (по умолчанию 1: bothost и подобные PaaS ставят ровно
  // один). Значение обязано соответствовать реальной схеме развёртывания:
  // Express отсчитывает столько «доверенных» хопов справа в
  // X-Forwarded-For, и если прокси на самом деле нет, то req.ip станет
  // ровно тем адресом, который прислал сам клиент, — лимитеры начнут
  // считать по выдуманным адресам, а в логи попадёт не тот, кто пришёл.
  // Прокси в max-proxy/ со своей стороны затирает клиентский
  // X-Forwarded-For адресом сокета, так что цепочка остаётся доверенной.
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      // Mini App должен встраиваться Telegram (в т.ч. в iframe на web.telegram.org) —
      // стандартный X-Frame-Options: SAMEORIGIN это ломает.
      frameguard: false,
      // CSP: дефолты helmet уже допускают инлайн-style (style-src включает
      // 'unsafe-inline' по умолчанию — вёрстка с inline style="..." не
      // ломается), поэтому здесь переопределяем только три директивы:
      // - script-src: по умолчанию только 'self', добавляем CDN Telegram и
      //   MAX — оттуда грузятся мостовые скрипты платформ (<script src=...>
      //   в index.html). Инлайн-<script> в приложении нет вообще (все
      //   обработчики через addEventListener в app.js), так что 'self' + эти
      //   два домена — и никакой сторонний/инжектированный скрипт (например,
      //   через XSS, если где-то пропущен escapeHtml) выполниться не сможет.
      // - img-src: по умолчанию 'self' и data: — добавляем blob:, он нужен
      //   для превью выбранного файла перед загрузкой (URL.createObjectURL).
      // - frame-ancestors: у helmet по умолчанию 'self', что запретило бы
      //   Telegram/MAX встраивать Mini App в свой WebView/iframe. Раньше
      //   директива убиралась совсем (null) — то есть страницу мог
      //   встроить в iframe вообще любой сайт. Для задачи это избыточно:
      //   достаточно перечислить те площадки, которым встраивание нужно.
      //   frame-ancestors не наследуется от default-src, поэтому её надо
      //   задавать явно, иначе она просто исчезает из заголовка.
      contentSecurityPolicy: {
        directives: {
          scriptSrc: ["'self'", 'https://telegram.org', 'https://st.max.ru'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          frameAncestors: ["'self'", 'https://*.telegram.org', 'https://*.max.ru', 'https://*.oneme.ru'],
        },
      },
      // По умолчанию helmet ставит Referrer-Policy: no-referrer — из-за этого
      // браузер не передаёт заголовок Referer при обращении Telegram Login
      // Widget к oauth.telegram.org, а Telegram сверяет домен именно по нему.
      // Без реферера виджет всегда отвечает "Bot domain invalid", даже если
      // домен в BotFather прописан верно. strict-origin-when-cross-origin —
      // это и есть современный дефолт браузеров: отдаёт origin (без пути)
      // на чужие HTTPS-домены, этого достаточно для проверки Telegram.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // Cross-Origin-Opener-Policy: same-origin (дефолт helmet) изолирует
      // всплывающее окно/попап от родительской страницы, обрывая
      // window.opener — именно на нём построены такие OAuth/login-виджеты,
      // как у Telegram и Google. Без этого виджет не может сообщить
      // странице результат входа и выглядит как постоянная ошибка домена.
      crossOriginOpenerPolicy: false,
    })
  );

  // Ограничиваем размер тела запроса — иначе один клиент может прислать
  // гигантский JSON и занять память/CPU процесса на его разборе.
  app.use(express.json({ limit: '100kb' }));

  // Базовая защита от флуда на уровне IP для всего приложения (включая статику).
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // Более строгий лимит на API — запросы сюда всегда бьют в БД (better-sqlite3
  // синхронный, так что каждый запрос блокирует event loop на время выполнения).
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // Проверка живости для хостинга и мониторинга. Отвечает 200, только
  // если БД реально отвечает на запрос: процесс может быть жив, а файл
  // базы при этом оказаться недоступен (диск заполнен, том не
  // примонтирован) — тогда приложение внешне «работает», а на деле не
  // обслуживает ни одного запроса. Ничего приватного не отдаёт.
  app.get('/healthz', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ ok: true, version: config.appVersion });
    } catch (err) {
      console.error('Health-check: БД не отвечает:', err);
      res.status(503).json({ ok: false, error: 'База данных недоступна' });
    }
  });

  // Публичный, без авторизации — нужен фронтенду только чтобы собрать
  // ссылку-приглашение t.me/<бот>, никаких приватных данных не отдаёт.
  app.get('/api/config', (_req, res) => {
    res.json({ botUsername: getBotUsername(), appVersion: config.appVersion });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/rides', ridesRouter);
  app.use('/api/bookings', bookingsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/support', supportRouter);
  app.use('/api/ratings', ratingsRouter);

  app.use('/uploads', express.static(uploadsDir));
  app.use(
    express.static(path.join(__dirname, '..', '..', 'public'), {
      setHeaders: (res, filePath) => {
        // index.html не кэшируем вовсе — иначе Telegram/MAX клиент годами
        // показывает старую версию Mini App внутри своего WebView.
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
          // app.js/styles.css подключаются из index.html с ?v=NN — при любом
          // изменении файла версия в разметке бампается вручную, то есть
          // URL меняется. Раз URL всегда новый при реальном изменении,
          // можно кэшировать текущий URL надолго и не тратить время на
          // повторную загрузку при каждом открытии.
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    // Часть обработчиков отвечает клиенту раньше, чем заканчивает работу
    // (рассылка в admin.ts отвечает сразу и рассылает в фоне) — если такой
    // обработчик упадёт уже после ответа, писать в res нельзя: заголовки
    // отправлены, и попытка ответить бросит ERR_HTTP_HEADERS_SENT прямо
    // здесь, в обработчике ошибок. Ошибка уже залогирована выше — просто
    // закрываем соединение.
    if (res.headersSent) {
      res.end();
      return;
    }
    // body-parser и подобные middleware кладут осмысленный статус (напр. 413
    // при превышении лимита размера тела) в err.status/err.statusCode —
    // уважаем его вместо того, чтобы всегда отвечать 500.
    const withStatus = err as { status?: number; statusCode?: number };
    const status =
      typeof withStatus?.status === 'number'
        ? withStatus.status
        : typeof withStatus?.statusCode === 'number'
          ? withStatus.statusCode
          : 500;
    const message = status === 413 ? 'Слишком большой запрос' : 'Внутренняя ошибка сервера';
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
  });

  return app;
}

