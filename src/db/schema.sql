-- Пользователи Telegram: и водители, и пассажиры — одна таблица,
-- роль определяется наличием строки в driver_profiles.
CREATE TABLE IF NOT EXISTS users (
  telegram_id     INTEGER PRIMARY KEY,
  first_name      TEXT NOT NULL,
  last_name       TEXT,
  username        TEXT,
  phone           TEXT,
  phone_verified  INTEGER NOT NULL DEFAULT 0, -- 1, если номер подтверждён через Telegram-контакт
  banned          INTEGER NOT NULL DEFAULT 0, -- 1, если администратор заблокировал доступ
  last_seen_at    TEXT,                       -- обновляется на каждом запросе к API — грубая метка "онлайн"
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Анкета водителя. Создаётся только после подтверждения телефона —
-- это и есть защита от фейковых объявлений.
CREATE TABLE IF NOT EXISTS driver_profiles (
  telegram_id   INTEGER PRIMARY KEY REFERENCES users(telegram_id),
  car_model     TEXT NOT NULL,
  car_color     TEXT,
  car_plate     TEXT NOT NULL,
  experience    TEXT,          -- короткое описание / стаж, по желанию
  photo_path    TEXT,          -- файл фото водителя или машины (см. /uploads)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Шаблоны регулярных поездок водителя (например, «каждый будний день в 8:00»).
-- weekdays — дни недели через запятую в формате JS Date.getDay() (0=вс..6=сб).
-- Реальные строки в rides генерируются периодической задачей на несколько
-- дней вперёд — сам шаблон не участвует в поиске/бронировании напрямую.
CREATE TABLE IF NOT EXISTS ride_templates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id         INTEGER NOT NULL REFERENCES users(telegram_id),
  from_city         TEXT NOT NULL CHECK (from_city IN ('Челябинск','Кунашак')),
  to_city           TEXT NOT NULL CHECK (to_city IN ('Челябинск','Кунашак')),
  departure_time    TEXT NOT NULL, -- 'HH:MM', местное время Челябинска/Кунашака
  weekdays          TEXT NOT NULL, -- '1,2,3,4,5'
  price_per_seat    INTEGER NOT NULL CHECK (price_per_seat >= 0),
  seats_total       INTEGER NOT NULL CHECK (seats_total BETWEEN 1 AND 8),
  comment           TEXT,
  meeting_point     TEXT,
  dropoff_point     TEXT,
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Поездки (объявления водителей)
CREATE TABLE IF NOT EXISTS rides (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id         INTEGER NOT NULL REFERENCES users(telegram_id),
  from_city         TEXT NOT NULL CHECK (from_city IN ('Челябинск','Кунашак')),
  to_city           TEXT NOT NULL CHECK (to_city IN ('Челябинск','Кунашак')),
  departure_at      TEXT NOT NULL,          -- ISO datetime
  price_per_seat    INTEGER NOT NULL CHECK (price_per_seat >= 0),
  seats_total       INTEGER NOT NULL CHECK (seats_total BETWEEN 1 AND 8),
  seats_available   INTEGER NOT NULL,
  comment           TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','completed')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rides_search
  ON rides (status, from_city, to_city, departure_at);

-- Бронирования мест пассажирами. Место резервируется сразу при бронировании
-- (status='pending'), но становится окончательным только после того, как
-- водитель подтвердит его кнопкой в чате с ботом (status='confirmed').
CREATE TABLE IF NOT EXISTS bookings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id       INTEGER NOT NULL REFERENCES rides(id),
  passenger_id  INTEGER NOT NULL REFERENCES users(telegram_id),
  seats_booked  INTEGER NOT NULL CHECK (seats_booked BETWEEN 1 AND 8),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_ride ON bookings (ride_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_passenger ON bookings (passenger_id, status);

-- Обращения в поддержку: и из Mini App, и из обычного текстового сообщения боту.
-- from_admin=1 — это ответ администратора конкретному user_id (уходит ему через бота).
CREATE TABLE IF NOT EXISTS support_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(telegram_id),
  message     TEXT NOT NULL,
  from_admin  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_support_user ON support_messages (user_id);

-- Оценки водителей пассажирами. Одна оценка на пару (поездка, пассажир),
-- доступна только после того, как поездка фактически состоялась (departure_at в прошлом)
-- и бронь была подтверждена водителем.
CREATE TABLE IF NOT EXISTS ratings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id       INTEGER NOT NULL REFERENCES rides(id),
  driver_id     INTEGER NOT NULL REFERENCES users(telegram_id),
  passenger_id  INTEGER NOT NULL REFERENCES users(telegram_id),
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (ride_id, passenger_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_driver ON ratings (driver_id);

-- Оценки пассажиров водителями — зеркало ratings в обратную сторону: помогает
-- водителю решить, подтверждать ли бронь ненадёжного пассажира. Те же условия:
-- поездка состоялась, бронь была подтверждена, одна оценка на пару (поездка, пассажир).
CREATE TABLE IF NOT EXISTS passenger_ratings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id       INTEGER NOT NULL REFERENCES rides(id),
  driver_id     INTEGER NOT NULL REFERENCES users(telegram_id),
  passenger_id  INTEGER NOT NULL REFERENCES users(telegram_id),
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (ride_id, passenger_id)
);

CREATE INDEX IF NOT EXISTS idx_passenger_ratings_passenger ON passenger_ratings (passenger_id);

-- Веб-сессии для входа с ПК/браузера вне Mini App (там нет initData,
-- поэтому нужен обычный cookie-based сеанс). Выдаются после подтверждения
-- кода в чате с ботом — Telegram или MAX (см. login_codes ниже).
CREATE TABLE IF NOT EXISTS web_sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(telegram_id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions (user_id);

-- Одноразовые коды для входа в браузерной версии: ни у MAX, ни (с недавних
-- пор — Telegram отключил классический Login Widget) у Telegram нет
-- рабочего публичного login-виджета/OAuth для сторонних сайтов. Пользователь
-- получает код на сайте и присылает его боту в чат — любому из двух, — бот
-- подтверждает код и привязывает к нему свой user_id.
CREATE TABLE IF NOT EXISTS login_codes (
  code        TEXT PRIMARY KEY,
  poll_token  TEXT,
  user_id     INTEGER REFERENCES users(telegram_id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);
