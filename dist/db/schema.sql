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
CREATE TABLE IF NOT EXISTS support_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(telegram_id),
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_support_user ON support_messages (user_id);
