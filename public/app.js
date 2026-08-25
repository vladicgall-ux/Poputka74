(() => {
  const tg = window.Telegram?.WebApp;
  // MAX Bridge (st.max.ru/js/max-web-app.js) — тот же принцип, что у Telegram:
  // глобальный объект с initData, только называется window.WebApp.
  const maxApp = window.WebApp;

  if (tg) {
    tg.ready();
    tg.expand();
    // Без этого нативные виджеты (например, значок и текст в <input type="date">)
    // рисуются в светлой схеме браузера и становятся невидимыми на тёмном фоне.
    const syncColorScheme = () => {
      document.documentElement.style.colorScheme = tg.colorScheme === 'dark' ? 'dark' : 'light';
    };
    syncColorScheme();
    tg.onEvent('themeChanged', syncColorScheme);
  } else if (maxApp) {
    maxApp.ready?.();
  }
  // Читаем initData каждый раз заново, а не один раз при загрузке: у
  // Telegram initData синхронно готов сразу, а у MAX Bridge (судя по
  // тому, что заголовок реально приходит на сервер, но пустой) он
  // заполняется с задержкой — иногда уже после того, как этот скрипт
  // начал выполняться. waitForInitData() ниже ждёт этот момент явно.
  function currentInitData() {
    return window.Telegram?.WebApp?.initData || window.WebApp?.initData || '';
  }
  // Какой заголовок нести до бэкенда — тот определяет, каким алгоритмом
  // проверять подпись (у Telegram и MAX разные секреты бота).
  function authHeader() {
    if (window.Telegram?.WebApp?.initData) return { 'X-Telegram-Init-Data': currentInitData() };
    return { 'X-Max-Init-Data': currentInitData() };
  }
  // MAX Bridge, в отличие от Telegram, не гарантирует initData сразу же
  // после загрузки скрипта — ждём до 3 секунд, проверяя каждые 100мс.
  function waitForInitData() {
    if (tg || currentInitData()) return Promise.resolve();
    return new Promise((resolve) => {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (currentInitData() || attempts >= 30) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  }

  const state = {
    direction: { from: 'Челябинск', to: 'Кунашак' },
    me: null,
    driverProfile: null,
    searchDate: null,
    driverRange: 'day',
    passengerRange: 'all',
    botUsername: null,
    activeTab: 'search',
  };

  // Локальная дата устройства (НЕ toISOString — та берёт UTC и ночью
  // после полуночи, но до рассвета, ошибочно показывает "вчера").
  function toDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Вычисляет {from, to} (YYYY-MM-DD) по пресету, либо null для 'all'. */
  function rangeToDates(preset) {
    if (preset === 'all') return null;
    if (preset.startsWith('date:')) {
      const date = preset.slice(5);
      return { from: date, to: date };
    }
    const today = new Date();
    const to = toDateStr(today);
    const days = preset === 'week' ? 6 : preset === 'month' ? 29 : 0;
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - days);
    return { from: toDateStr(fromDate), to };
  }

  // ---------- API helper ----------
  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(),
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Ошибка запроса');
    }
    return data;
  }

  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  }

  // ---------- Tabs ----------
  const tabs = ['search', 'offer', 'mine', 'profile', 'admin'];
  function showTab(name) {
    state.activeTab = name;
    tabs.forEach((t) => {
      document.getElementById(`tab-${t}`).hidden = t !== name;
    });
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === name);
    });
    if (name === 'search') loadRides();
    if (name === 'offer') loadOfferTab();
    if (name === 'mine') loadMineTab();
    if (name === 'profile') loadProfileTab();
    if (name === 'admin') loadAdminTab();
  }
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  // Уведомления о бронях/отменах приходят в чат бота, а не пушем в само
  // приложение — если вкладка «Мои поездки» (или любая другая) уже открыта,
  // без этого её данные (например, свободные места) останутся устаревшими,
  // пока пользователь не переключит вкладку вручную. Обновляем текущую
  // вкладку каждый раз, когда пользователь возвращается в открытое приложение.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) showTab(state.activeTab);
  });

  // ---------- Search tab ----------
  document.getElementById('directionSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('.dir-btn');
    if (!btn) return;
    document.querySelectorAll('.dir-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.direction = { from: btn.dataset.from, to: btn.dataset.to };
    loadRides();
  });

  function starsHtml(avg, count) {
    if (!count) return '<span class="rating-line">Пока нет оценок</span>';
    const rounded = Math.round(avg);
    let stars = '';
    for (let i = 1; i <= 5; i++) stars += `<span class="${i <= rounded ? 'filled' : ''}">★</span>`;
    return `<span class="rating-line"><span class="stars">${stars}</span> ${avg} (${count})</span>`;
  }

  function rideCardHtml(ride, opts = {}) {
    const full = ride.seats_available <= 0;
    const badge = ride.status === 'cancelled'
      ? '<span class="badge cancelled">Отменена</span>'
      : ride.status === 'completed'
        ? '<span class="badge completed">Поездка выполнена</span>'
        : full
          ? '<span class="badge full">Мест нет</span>'
          : `<span class="badge ok">${ride.seats_available} мест свободно</span>`;
    const driverLine = ride.driver_first_name
      ? `<div class="driver-row">
          ${ride.photo_path ? `<img class="driver-avatar" src="/uploads/${ride.photo_path}" alt="" />` : ''}
          <div class="driver">${escapeHtml(ride.driver_full_name || ride.driver_first_name)} · ${escapeHtml(ride.car_model)}${ride.car_color ? ', ' + escapeHtml(ride.car_color) : ''} · ${escapeHtml(ride.car_plate)}</div>
        </div>`
      : '';
    const ratingLine = ride.driver_first_name ? starsHtml(ride.avg_rating, ride.rating_count) : '';
    const actionHtml = opts.action || '';
    return `
      <div class="card ride-card" data-ride-id="${ride.id}">
        <div class="row">
          <div class="route">${escapeHtml(ride.from_city)} → ${escapeHtml(ride.to_city)}</div>
          ${badge}
        </div>
        <div class="meta">
          <span>🗓 ${formatDate(ride.departure_at)}</span>
          <span class="price">${ride.price_per_seat} ₽/место</span>
        </div>
        ${driverLine}
        ${ratingLine}
        ${ride.comment ? `<div class="comment">${escapeHtml(ride.comment)}</div>` : ''}
        ${actionHtml}
      </div>`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Нормализует номер — некоторые телефоны не открывают звонилку по ссылке
  // без ведущего +, а Telegram иногда отдаёт номер как "79..." или "89..." без плюса.
  function normalizePhone(phone) {
    let digits = String(phone).replace(/[^\d+]/g, '');
    if (!digits.startsWith('+')) {
      if (digits.startsWith('8') && digits.length === 11) digits = '+7' + digits.slice(1);
      else digits = '+' + digits;
    }
    return digits;
  }

  // Встроенный браузер Telegram Mini App блокирует переход по tel: —
  // обычная ссылка на звонилку там не срабатывает (ограничение клиента,
  // не наш код). Поэтому по тапу копируем номер в буфер обмена, чтобы
  // сразу вставить его в приложение «Телефон».
  function phoneLink(phone) {
    if (!phone) return 'номер не указан';
    const normalized = normalizePhone(phone);
    return `<button type="button" class="phone-link" data-phone="${escapeHtml(normalized)}">📞 ${escapeHtml(phone)}</button>`;
  }

  async function copyPhone(phone) {
    try {
      await navigator.clipboard.writeText(phone);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = phone;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(textarea);
    }
    toast(`Номер скопирован: ${phone}`);
  }

  document.body.addEventListener('click', async (e) => {
    const phoneBtn = e.target.closest('.phone-link');
    if (phoneBtn) {
      copyPhone(phoneBtn.dataset.phone);
      return;
    }
    if (e.target.id === 'profileNameSaveBtn') {
      const input = document.getElementById('profileNameInput');
      const fullName = input.value.trim();
      if (!fullName.includes(' ') || fullName.length < 3) {
        toast('Укажите имя и фамилию через пробел');
        return;
      }
      try {
        await api('/users/me/name', { method: 'POST', body: JSON.stringify({ fullName }) });
        toast('Имя сохранено');
      } catch (err) {
        toast(err.message);
      }
    }
  });

  // По умолчанию поиск сразу отфильтрован на сегодня — самый частый случай.
  state.searchDate = toDateStr(new Date());
  document.getElementById('searchDate').value = state.searchDate;

  document.getElementById('searchDate').addEventListener('change', (e) => {
    state.searchDate = e.target.value || null;
    loadRides();
  });
  document.getElementById('clearDateBtn').addEventListener('click', () => {
    document.getElementById('searchDate').value = '';
    state.searchDate = null;
    loadRides();
  });

  function seatOptions(max) {
    let opts = '';
    for (let i = 1; i <= max; i++) opts += `<option value="${i}">${i}</option>`;
    return opts;
  }

  async function loadRides() {
    const list = document.getElementById('ridesList');
    const empty = document.getElementById('ridesEmpty');
    list.innerHTML = '';
    try {
      const params = new URLSearchParams({ from: state.direction.from, to: state.direction.to });
      if (state.searchDate) params.set('date', state.searchDate);
      const { rides } = await api(`/rides?${params.toString()}`);
      empty.hidden = rides.length > 0;
      list.innerHTML = rides.map((r) => rideCardHtml(r, {
        action: r.seats_available > 0
          ? `<div class="seat-picker">
              <label>Мест:</label>
              <select class="seat-select" data-ride-id="${r.id}">${seatOptions(Math.min(r.seats_available, 8))}</select>
              <button class="btn small book-btn" data-ride-id="${r.id}">Забронировать</button>
            </div>`
          : '',
      })).join('');
    } catch (err) {
      toast(err.message);
    }
  }

  document.getElementById('ridesList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.book-btn');
    if (!btn) return;
    const rideId = Number(btn.dataset.rideId);
    const seatSelect = btn.closest('.seat-picker').querySelector('.seat-select');
    const seats = Number(seatSelect.value);
    btn.disabled = true;
    try {
      await api('/bookings', { method: 'POST', body: JSON.stringify({ rideId, seats }) });
      toast('Заявка отправлена водителю! Ждите подтверждения в чате с ботом.');
      loadRides();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });

  // ---------- Offer tab ----------
  async function loadOfferTab() {
    try {
      const { user, driverProfile } = await api('/users/me');
      state.me = user;
      state.driverProfile = driverProfile;

      const gate = document.getElementById('phoneGate');
      const driverForm = document.getElementById('driverForm');
      const rideForm = document.getElementById('rideForm');

      if (!user.phone_verified) {
        gate.hidden = false;
        driverForm.hidden = true;
        rideForm.hidden = true;
        return;
      }
      gate.hidden = true;
      driverForm.hidden = false;

      if (driverProfile) {
        document.getElementById('carModel').value = driverProfile.car_model;
        document.getElementById('carColor').value = driverProfile.car_color || '';
        document.getElementById('carPlate').value = driverProfile.car_plate;
        document.getElementById('carExperience').value = driverProfile.experience || '';
        rideForm.hidden = false;

        document.getElementById('driverPhotoCard').hidden = false;
        const preview = document.getElementById('driverPhotoPreview');
        if (driverProfile.photo_path) {
          preview.src = `/uploads/${driverProfile.photo_path}`;
          preview.style.display = 'block';
        } else {
          preview.style.display = 'none';
        }
      } else {
        rideForm.hidden = true;
        document.getElementById('driverPhotoCard').hidden = true;
      }
    } catch (err) {
      toast(err.message);
    }
  }

  document.getElementById('openBotFromOffer').addEventListener('click', () => {
    tg?.close();
  });

  document.getElementById('driverForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { driverProfile } = await api('/users/me/driver-profile', {
        method: 'POST',
        body: JSON.stringify({
          car_model: document.getElementById('carModel').value,
          car_color: document.getElementById('carColor').value,
          car_plate: document.getElementById('carPlate').value,
          experience: document.getElementById('carExperience').value,
        }),
      });
      state.driverProfile = driverProfile;
      document.getElementById('rideForm').hidden = false;
      document.getElementById('driverPhotoCard').hidden = false;
      toast('Анкета водителя сохранена');
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('driverPhotoUploadBtn').addEventListener('click', async () => {
    const input = document.getElementById('driverPhotoInput');
    const file = input.files?.[0];
    if (!file) {
      toast('Выберите файл фото');
      return;
    }
    const formData = new FormData();
    formData.append('photo', file);
    try {
      const res = await fetch('/api/users/me/photo', {
        method: 'POST',
        headers: authHeader(),
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');
      const preview = document.getElementById('driverPhotoPreview');
      preview.src = data.photoUrl + '?t=' + Date.now();
      preview.style.display = 'block';
      input.value = '';
      toast('Фото загружено');
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('rideForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const [fromCity, toCity] = document.getElementById('rideDirection').value.split('|');
    const departureInput = document.getElementById('rideDeparture').value;
    if (!departureInput) {
      toast('Укажите дату и время отправления');
      return;
    }
    try {
      await api('/rides', {
        method: 'POST',
        body: JSON.stringify({
          fromCity,
          toCity,
          departureAt: new Date(departureInput).toISOString(),
          pricePerSeat: Number(document.getElementById('ridePrice').value),
          seatsTotal: Number(document.getElementById('rideSeats').value),
          comment: document.getElementById('rideComment').value,
        }),
      });
      toast('Поездка опубликована!');
      e.target.reset();
      document.getElementById('rideSeats').value = 3;
      showTab('mine');
    } catch (err) {
      toast(err.message);
    }
  });

  // ---------- Mine tab ----------
  document.getElementById('driverRangeFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('.dir-btn');
    if (!btn) return;
    document.querySelectorAll('#driverRangeFilter .dir-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('driverRangeDate').value = toDateStr(new Date());
    state.driverRange = btn.dataset.range;
    loadMineTab();
  });
  document.getElementById('driverRangeDate').addEventListener('change', (e) => {
    if (!e.target.value) return;
    document.querySelectorAll('#driverRangeFilter .dir-btn').forEach((b) => b.classList.remove('active'));
    state.driverRange = `date:${e.target.value}`;
    loadMineTab();
  });

  document.getElementById('passengerRangeFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('.dir-btn');
    if (!btn) return;
    document.querySelectorAll('#passengerRangeFilter .dir-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('passengerRangeDate').value = toDateStr(new Date());
    state.passengerRange = btn.dataset.range;
    loadMineTab();
  });
  document.getElementById('passengerRangeDate').addEventListener('change', (e) => {
    if (!e.target.value) return;
    document.querySelectorAll('#passengerRangeFilter .dir-btn').forEach((b) => b.classList.remove('active'));
    state.passengerRange = `date:${e.target.value}`;
    loadMineTab();
  });

  // Поле даты сразу показывает сегодня, а не пусто — как и в поиске.
  // Активный пресет (День/Неделя/...) от этого не меняется, пока пользователь сам не тронет поле.
  document.getElementById('driverRangeDate').value = toDateStr(new Date());
  document.getElementById('passengerRangeDate').value = toDateStr(new Date());

  async function loadMineTab() {
    const ridesList = document.getElementById('myRidesList');
    const ridesEmpty = document.getElementById('myRidesEmpty');
    const bookingsList = document.getElementById('myBookingsList');
    const bookingsEmpty = document.getElementById('myBookingsEmpty');

    const driverRange = rangeToDates(state.driverRange);
    const driverQuery = driverRange ? `?from=${driverRange.from}&to=${driverRange.to}` : '';

    try {
      const { stats } = await api(`/rides/mine/stats${driverQuery}`);
      document.getElementById('driverStats').innerHTML = `
        <div class="stat-tile"><div class="value">${stats.ridesCount}</div><div class="label">Поездок</div></div>
        <div class="stat-tile"><div class="value">${stats.passengersCount}</div><div class="label">Пассажиров</div></div>
        <div class="stat-tile"><div class="value">${stats.earnings} ₽</div><div class="label">Заработано</div></div>
      `;
    } catch (err) {
      toast(err.message);
    }

    try {
      const { rides } = await api(`/rides/mine${driverQuery}`);
      ridesEmpty.hidden = rides.length > 0;
      ridesList.innerHTML = rides.map((r) => rideCardHtml(r, {
        action: `
          ${r.status === 'active' ? `<button class="btn secondary small cancel-ride-btn" data-ride-id="${r.id}">Отменить поездку</button>` : ''}
          <button type="button" class="btn small passenger-toggle-btn" data-ride-id="${r.id}">👥 Пассажиры</button>
          <div class="passengers-panel" id="passengers-${r.id}" hidden></div>
        `,
      })).join('');
    } catch (err) {
      toast(err.message);
    }

    const passengerRange = rangeToDates(state.passengerRange);
    const passengerQuery = passengerRange ? `?from=${passengerRange.from}&to=${passengerRange.to}` : '';

    try {
      const { bookings } = await api(`/bookings/mine${passengerQuery}`);
      const active = bookings.filter((b) => b.status === 'pending' || b.status === 'confirmed');
      bookingsEmpty.hidden = active.length > 0;
      bookingsList.innerHTML = active.map((b) => {
        const departed = new Date(b.departure_at).getTime() < Date.now();
        let footer = '';
        if (!departed) {
          footer = `<button class="btn secondary small cancel-booking-btn" data-booking-id="${b.id}">Отменить бронь</button>`;
        } else if (b.status === 'confirmed' && !b.rated) {
          footer = `
            <div class="rate-widget" data-ride-id="${b.ride_id}">
              ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star-btn" data-star="${n}">★</button>`).join('')}
              <button type="button" class="btn small rate-submit-btn" data-ride-id="${b.ride_id}" disabled>Оценить</button>
            </div>`;
        } else if (b.status === 'confirmed' && b.rated) {
          footer = `<div class="rating-line">Вы уже оценили эту поездку ✅</div>`;
        }
        return `
        <div class="card ride-card">
          <div class="row">
            <div class="route">${escapeHtml(b.from_city)} → ${escapeHtml(b.to_city)}</div>
            <span class="badge ${b.status === 'confirmed' ? 'ok' : 'pending'}">${b.status === 'confirmed' ? 'подтверждена' : 'ждём водителя'} · ${b.seats_booked} мест</span>
          </div>
          <div class="meta">
            <span>🗓 ${formatDate(b.departure_at)}</span>
            <span class="price">${b.price_per_seat * b.seats_booked} ₽</span>
          </div>
          ${footer}
        </div>`;
      }).join('');
    } catch (err) {
      toast(err.message);
    }
  }

  document.getElementById('myBookingsList').addEventListener('click', async (e) => {
    const starBtn = e.target.closest('.star-btn');
    if (starBtn) {
      const widget = starBtn.closest('.rate-widget');
      const value = Number(starBtn.dataset.star);
      widget.dataset.selected = value;
      widget.querySelectorAll('.star-btn').forEach((b) => {
        b.classList.toggle('filled', Number(b.dataset.star) <= value);
      });
      widget.querySelector('.rate-submit-btn').disabled = false;
      return;
    }
    const submitBtn = e.target.closest('.rate-submit-btn');
    if (submitBtn) {
      const widget = submitBtn.closest('.rate-widget');
      const rating = Number(widget.dataset.selected);
      submitBtn.disabled = true;
      try {
        await api('/ratings', { method: 'POST', body: JSON.stringify({ rideId: Number(widget.dataset.rideId), rating }) });
        toast('Спасибо за оценку!');
        loadMineTab();
      } catch (err) {
        toast(err.message);
        submitBtn.disabled = false;
      }
    }
  });

  document.getElementById('myRidesList').addEventListener('click', async (e) => {
    const cancelBtn = e.target.closest('.cancel-ride-btn');
    if (cancelBtn) {
      if (!confirm('Отменить поездку?')) return;
      try {
        await api(`/rides/${cancelBtn.dataset.rideId}/cancel`, { method: 'POST' });
        toast('Поездка отменена');
        loadMineTab();
      } catch (err) {
        toast(err.message);
      }
      return;
    }

    const toggleBtn = e.target.closest('.passenger-toggle-btn');
    if (toggleBtn) {
      const rideId = toggleBtn.dataset.rideId;
      const panel = document.getElementById(`passengers-${rideId}`);
      if (!panel.hidden) {
        panel.hidden = true;
        return;
      }
      panel.hidden = false;
      panel.innerHTML = '<p class="empty">Загрузка...</p>';
      try {
        const { passengers, earnings } = await api(`/rides/${rideId}/passengers`);
        if (!passengers.length) {
          panel.innerHTML = '<p class="empty">Пока никто не забронировал место.</p>';
          return;
        }
        panel.innerHTML = passengers.map((p) => `
          <div class="passenger-row">
            <span>
              ${escapeHtml(p.full_name || p.first_name || 'Без имени')}${p.username ? ' · @' + escapeHtml(p.username) : ''}<br>
              ${phoneLink(p.phone)} · ID ${p.passenger_id}
            </span>
            <span>${p.seats_booked} мест · ${p.status === 'confirmed' ? '✅ подтверждено' : '⏳ ждёт'}</span>
          </div>
        `).join('') + `<div class="earnings-total">Заработок с поездки: ${earnings} ₽</div>`;
      } catch (err) {
        panel.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
      }
    }
  });

  document.getElementById('myBookingsList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.cancel-booking-btn');
    if (!btn) return;
    if (!confirm('Отменить бронирование?')) return;
    try {
      await api(`/bookings/${btn.dataset.bookingId}/cancel`, { method: 'POST' });
      toast('Бронирование отменено');
      loadMineTab();
    } catch (err) {
      toast(err.message);
    }
  });

  // ---------- Profile tab ----------
  async function loadProfileTab() {
    try {
      const { user, driverProfile, isAdmin, rating } = await api('/users/me');
      state.me = user;
      document.getElementById('adminTabBtn').hidden = !isAdmin;
      const card = document.getElementById('profileCard');
      card.innerHTML = `
        <div class="profile-row"><span class="label">Username</span><span>${user.username ? '@' + escapeHtml(user.username) : '—'}</span></div>
        <div class="profile-row"><span class="label">Телефон</span><span>${user.phone_verified ? '✅ подтверждён' : '❌ не подтверждён'}</span></div>
        <div class="profile-row"><span class="label">Водитель</span><span>${driverProfile ? `✅ ${escapeHtml(driverProfile.car_model)}` : '—'}</span></div>
        ${driverProfile ? `<div class="profile-row"><span class="label">Ваш рейтинг</span><span>${starsHtml(rating?.avg, rating?.count)}</span></div>` : ''}
        <div class="profile-row" style="margin-top:6px;">
          <span class="label">Имя и фамилия</span>
        </div>
        <input type="text" id="profileNameInput" placeholder="Имя и фамилия" maxlength="100" value="${escapeHtml(user.full_name || '')}" />
        <button type="button" class="btn small" id="profileNameSaveBtn" style="margin-top:8px;">Сохранить</button>
      `;
    } catch (err) {
      toast(err.message);
    }
  }

  const MAX_BOT_LINK = 'https://max.ru/se14080601_bot';

  document.getElementById('inviteFriendsBtn').addEventListener('click', async () => {
    // Кнопка живёт на вкладке «Профиль», которая обычно уже успевает
    // подгрузить state.me — но на всякий случай (медленная сеть) подстрахуемся.
    if (!state.me) {
      try {
        const { user } = await api('/users/me');
        state.me = user;
      } catch (err) {
        toast('Не удалось определить платформу, попробуйте ещё раз');
        return;
      }
    }

    const inviteText =
      '🚗 «Поехали 74» — попутчики Челябинск ⇄ Кунашак.\n' +
      'Ищи попутку или предлагай свободные места в поездке — быстро и без лишних сообщений.';

    // window.WebApp существует на любой платформе (скрипт max-web-app.js
    // подключён всегда), поэтому одного его наличия недостаточно, чтобы
    // отличить реальный MAX от Telegram — доверяем платформе, которую
    // определил сервер при авторизации (state.me.platform).
    // В MAX нет аналога t.me/share/url, поэтому шарим через стандартный
    // Web Share API (системное окно «Поделиться»), а если оно недоступно —
    // просто копируем текст со ссылкой в буфер обмена.
    if (state.me?.platform === 'max') {
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Поехали 74', text: inviteText, url: MAX_BOT_LINK });
          return;
        } catch (err) {
          // Пользователь закрыл системное окно шаринга — не ошибка, просто выходим.
          if (err?.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(`${inviteText}\n${MAX_BOT_LINK}`);
        toast('Ссылка скопирована — отправьте её друзьям в любом чате');
      } catch (err) {
        window.open(MAX_BOT_LINK, '_blank');
      }
      return;
    }

    if (!state.botUsername) {
      try {
        const res = await fetch('/api/config');
        const data = await res.json();
        state.botUsername = data.botUsername;
      } catch (err) {
        toast('Не удалось получить ссылку на бота');
        return;
      }
    }
    if (!state.botUsername) {
      toast('Ссылка на бота пока недоступна, попробуйте чуть позже');
      return;
    }
    const botLink = `https://t.me/${state.botUsername}`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(botLink)}&text=${encodeURIComponent(inviteText)}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
    else window.open(shareUrl, '_blank');
  });

  document.getElementById('supportSendBtn').addEventListener('click', async () => {
    const textarea = document.getElementById('supportMessage');
    const message = textarea.value.trim();
    if (!message) {
      toast('Введите текст сообщения');
      return;
    }
    try {
      await api('/support', { method: 'POST', body: JSON.stringify({ message }) });
      textarea.value = '';
      toast('Сообщение отправлено в поддержку');
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('mineSubSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('.dir-btn');
    if (!btn) return;
    document.querySelectorAll('#mineSubSwitch .dir-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.mineTab;
    document.getElementById('mineDriverSection').hidden = target !== 'driver';
    document.getElementById('minePassengerSection').hidden = target !== 'passenger';
  });

  // ---------- Admin tab ----------
  document.getElementById('adminSubSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('.dir-btn');
    if (!btn) return;
    document.querySelectorAll('#adminSubSwitch .dir-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.adminTab;
    document.getElementById('adminUsersList').hidden = target !== 'users';
    document.getElementById('adminRidesList').hidden = target !== 'rides';
    document.getElementById('adminBookingsList').hidden = target !== 'bookings';
    document.getElementById('adminSupportList').hidden = target !== 'support';
    document.getElementById('adminBroadcastPanel').hidden = target !== 'broadcast';
  });

  async function loadAdminTab() {
    try {
      const { stats } = await api('/admin/stats');
      document.getElementById('adminStats').innerHTML = `
        <div class="stat-tile"><div class="value">${stats.totalUsers}</div><div class="label">Всего пользователей</div></div>
        <div class="stat-tile"><div class="value">${stats.onlineUsers}</div><div class="label">Онлайн (5 мин)</div></div>
        <div class="stat-tile"><div class="value">${stats.drivers}</div><div class="label">Водителей</div></div>
        <div class="stat-tile"><div class="value">${stats.activeRides}</div><div class="label">Активных поездок</div></div>
      `;
    } catch (err) {
      toast(err.message);
    }

    try {
      const { users } = await api('/admin/users');
      document.getElementById('adminUsersList').innerHTML = users.map((u) => `
        <div class="card ride-card">
          <div class="row">
            <div class="route">${escapeHtml(u.full_name || u.first_name)}${u.username ? ' · @' + escapeHtml(u.username) : ''}</div>
            <span class="badge ${u.banned ? 'full' : u.phone_verified ? 'ok' : 'cancelled'}">${u.banned ? 'заблокирован' : u.phone_verified ? 'телефон подтверждён' : 'не подтверждён'}</span>
          </div>
          <div class="meta">
            <span>${u.platform === 'max' ? 'MAX' : 'Telegram'} ID: ${Math.abs(u.telegram_id)}</span>
            <span>${phoneLink(u.phone)}</span>
          </div>
          ${u.car_model ? `<div class="driver">Водитель: ${escapeHtml(u.car_model)} · ${escapeHtml(u.car_plate)}</div>` : ''}
          ${u.car_model ? starsHtml(u.avg_rating, u.rating_count) : ''}
          <button type="button" class="btn small user-detail-toggle-btn" data-telegram-id="${u.telegram_id}">📊 Подробнее</button>
          ${u.username && u.platform === 'telegram' ? `<button type="button" class="btn secondary small open-dialog-btn" data-username="${escapeHtml(u.username)}">💬 Написать</button>` : ''}
          <button class="btn ${u.banned ? '' : 'secondary'} small ban-toggle-btn" data-telegram-id="${u.telegram_id}" data-action="${u.banned ? 'unban' : 'ban'}">
            ${u.banned ? 'Разблокировать' : 'Заблокировать'}
          </button>
          <div class="user-detail-panel passengers-panel" id="user-detail-${u.telegram_id}" hidden></div>
        </div>
      `).join('') || '<p class="empty">Пока никто не зарегистрирован.</p>';
    } catch (err) {
      toast(err.message);
    }

    try {
      const { rides } = await api('/admin/rides');
      document.getElementById('adminRidesList').innerHTML = rides.map((r) => rideCardHtml(r)).join('')
        || '<p class="empty">Поездок пока нет.</p>';
    } catch (err) {
      toast(err.message);
    }

    try {
      const { bookings } = await api('/admin/bookings');
      document.getElementById('adminBookingsList').innerHTML = bookings.map((b) => `
        <div class="card ride-card">
          <div class="row">
            <div class="route">${escapeHtml(b.from_city)} → ${escapeHtml(b.to_city)}</div>
            <span class="badge ${b.status === 'confirmed' ? 'ok' : b.status === 'pending' ? 'pending' : 'cancelled'}">${b.status === 'confirmed' ? 'подтверждена' : b.status === 'pending' ? 'ждёт водителя' : 'отменена'}</span>
          </div>
          <div class="meta">
            <span>🗓 ${formatDate(b.departure_at)}</span>
            <span>${b.seats_booked} мест · ${b.price_per_seat * b.seats_booked} ₽</span>
          </div>
          <div class="driver">Пассажир: ${escapeHtml(b.passenger_first_name)}${b.passenger_username ? ' · @' + escapeHtml(b.passenger_username) : ''}${b.passenger_phone ? ' · ' + escapeHtml(b.passenger_phone) : ''}</div>
          <div class="driver">Водитель: ${escapeHtml(b.driver_first_name)}</div>
        </div>
      `).join('') || '<p class="empty">Бронирований пока нет.</p>';
    } catch (err) {
      toast(err.message);
    }

    try {
      const { messages } = await api('/admin/support');
      document.getElementById('adminSupportList').innerHTML = messages.map((m) => `
        <div class="card ride-card ${m.from_admin ? 'support-from-admin' : ''}">
          <div class="row">
            <div class="route">${m.from_admin ? 'Вы →' : ''} ${escapeHtml(m.full_name || m.first_name)}${m.username ? ' · @' + escapeHtml(m.username) : ''}</div>
            <span class="badge ok">${formatDate(m.created_at)}</span>
          </div>
          <div class="meta">
            <span>ID: ${m.user_id}</span>
            <span>${phoneLink(m.phone)}</span>
          </div>
          <div class="comment">${escapeHtml(m.message)}</div>
          ${!m.from_admin ? `
            <div class="support-reply">
              <input type="text" class="support-reply-input" placeholder="Ответить..." maxlength="1000" />
              <button type="button" class="btn small support-reply-btn" data-user-id="${m.user_id}">Отправить</button>
            </div>` : ''}
        </div>
      `).join('') || '<p class="empty">Обращений пока нет.</p>';
    } catch (err) {
      toast(err.message);
    }
  }

  document.getElementById('adminUsersList').addEventListener('click', async (e) => {
    const dialogBtn = e.target.closest('.open-dialog-btn');
    if (dialogBtn) {
      const url = `https://t.me/${dialogBtn.dataset.username}`;
      if (tg?.openTelegramLink) tg.openTelegramLink(url);
      else window.open(url, '_blank');
      return;
    }

    const banBtn = e.target.closest('.ban-toggle-btn');
    if (banBtn) {
      const telegramId = banBtn.dataset.telegramId;
      const action = banBtn.dataset.action;
      if (action === 'ban' && !confirm('Заблокировать этого пользователя? Он потеряет доступ к приложению.')) return;
      banBtn.disabled = true;
      try {
        await api(`/admin/users/${telegramId}/${action}`, { method: 'POST' });
        toast(action === 'ban' ? 'Пользователь заблокирован' : 'Пользователь разблокирован');
        loadAdminTab();
      } catch (err) {
        toast(err.message);
        banBtn.disabled = false;
      }
      return;
    }

    const detailBtn = e.target.closest('.user-detail-toggle-btn');
    if (detailBtn) {
      const telegramId = detailBtn.dataset.telegramId;
      const panel = document.getElementById(`user-detail-${telegramId}`);
      if (!panel.hidden) {
        panel.hidden = true;
        return;
      }
      panel.hidden = false;
      panel.innerHTML = '<p class="empty">Загрузка...</p>';
      try {
        const data = await api(`/admin/users/${telegramId}`);
        panel.innerHTML = userDetailHtml(data);
      } catch (err) {
        panel.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
      }
    }
  });

  function userDetailHtml(data) {
    const { driverProfile, driverStats, rating, rides, bookings, passengerStats } = data;
    const driverBlock = driverProfile
      ? `
        <h4>Как водитель</h4>
        <div class="stats-row">
          <div class="stat-tile"><div class="value">${driverStats.ridesCount}</div><div class="label">Поездок</div></div>
          <div class="stat-tile"><div class="value">${driverStats.passengersCount}</div><div class="label">Пассажиров</div></div>
          <div class="stat-tile"><div class="value">${driverStats.earnings} ₽</div><div class="label">Заработано</div></div>
        </div>
        ${starsHtml(rating?.avg, rating?.count)}
        ${rides.length ? rides.map((r) => `
          <div class="passenger-row">
            <span>${escapeHtml(r.from_city)} → ${escapeHtml(r.to_city)} · ${formatDate(r.departure_at)}</span>
            <span>${r.status === 'completed' ? '✅ выполнена' : r.status === 'cancelled' ? '❌ отменена' : '🟢 активна'}</span>
          </div>
        `).join('') : '<p class="empty">Поездок пока нет.</p>'}
      `
      : '';
    const passengerBlock = `
      <h4>Как пассажир</h4>
      <div class="stats-row">
        <div class="stat-tile"><div class="value">${passengerStats.bookingsCount}</div><div class="label">Бронирований</div></div>
        <div class="stat-tile"><div class="value">${passengerStats.totalSpent} ₽</div><div class="label">Потрачено</div></div>
      </div>
      ${bookings.length ? bookings.map((b) => `
        <div class="passenger-row">
          <span>${escapeHtml(b.from_city)} → ${escapeHtml(b.to_city)} · ${formatDate(b.departure_at)}</span>
          <span>${b.status === 'confirmed' ? '✅ подтверждена' : b.status === 'pending' ? '⏳ ждёт' : '❌ отменена'}</span>
        </div>
      `).join('') : '<p class="empty">Бронирований пока нет.</p>'}
    `;
    return driverBlock + passengerBlock;
  }

  document.getElementById('adminSupportList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.support-reply-btn');
    if (!btn) return;
    const card = btn.closest('.card');
    const input = card.querySelector('.support-reply-input');
    const message = input.value.trim();
    if (!message) {
      toast('Введите текст ответа');
      return;
    }
    btn.disabled = true;
    try {
      await api(`/admin/support/${btn.dataset.userId}/reply`, { method: 'POST', body: JSON.stringify({ message }) });
      toast('Ответ отправлен');
      loadAdminTab();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });

  document.getElementById('broadcastPhotoInput').addEventListener('change', () => {
    const input = document.getElementById('broadcastPhotoInput');
    const preview = document.getElementById('broadcastPhotoPreview');
    const file = input.files?.[0];
    if (file) {
      preview.src = URL.createObjectURL(file);
      preview.style.display = 'block';
    } else {
      preview.style.display = 'none';
    }
  });

  document.getElementById('broadcastSendBtn').addEventListener('click', async () => {
    const messageInput = document.getElementById('broadcastMessage');
    const photoInput = document.getElementById('broadcastPhotoInput');
    const message = messageInput.value.trim();
    const file = photoInput.files?.[0];
    if (!message && !file) {
      toast('Добавьте текст или фото');
      return;
    }
    if (!confirm('Отправить это сообщение всем пользователям бота?')) return;

    const btn = document.getElementById('broadcastSendBtn');
    btn.disabled = true;
    btn.textContent = 'Отправка...';
    try {
      const formData = new FormData();
      if (message) formData.append('message', message);
      if (file) formData.append('photo', file);
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: authHeader(),
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Ошибка рассылки');
      toast(`Отправлено ${data.sent} из ${data.total}`);
      messageInput.value = '';
      photoInput.value = '';
      document.getElementById('broadcastPhotoPreview').style.display = 'none';
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Отправить всем';
    }
  });

  // ---------- App gate: banned / unverified users can't enter at all ----------
  function showGate(title, text, showBotButton) {
    document.getElementById('gateTitle').textContent = title;
    document.getElementById('gateText').textContent = text;
    document.getElementById('gateActionBtn').hidden = !showBotButton;
    document.getElementById('gateNameForm').hidden = true;
    document.getElementById('app').hidden = true;
    document.querySelector('.tabbar').hidden = true;
    document.getElementById('appGate').hidden = false;
  }

  function showNameGate() {
    document.getElementById('gateTitle').textContent = 'Укажите имя и фамилию';
    document.getElementById('gateText').textContent =
      'Другие пользователи увидят это имя вместо ника из Telegram — так безопаснее и понятнее, кто едет или бронирует место.';
    document.getElementById('gateActionBtn').hidden = true;
    document.getElementById('gateNameForm').hidden = false;
    document.getElementById('app').hidden = true;
    document.querySelector('.tabbar').hidden = true;
    document.getElementById('appGate').hidden = false;
  }

  document.getElementById('gateActionBtn').addEventListener('click', () => {
    tg?.close();
  });

  document.getElementById('gateNameSubmitBtn').addEventListener('click', async () => {
    const input = document.getElementById('gateNameInput');
    const fullName = input.value.trim();
    if (!fullName.includes(' ') || fullName.length < 3) {
      toast('Укажите имя и фамилию через пробел');
      return;
    }
    try {
      await api('/users/me/name', { method: 'POST', body: JSON.stringify({ fullName }) });
      initApp();
    } catch (err) {
      toast(err.message);
    }
  });

  async function initApp() {
    try {
      const { user, isAdmin } = await api('/users/me');
      state.me = user;

      if (isAdmin) {
        document.getElementById('adminTabBtn').hidden = false;
        showTab('search');
        return;
      }
      if (user.banned) {
        showGate(
          'Аккаунт заблокирован',
          'Администратор ограничил вам доступ к приложению. Если считаете это ошибкой — напишите в чат с ботом.',
          true
        );
        return;
      }
      if (!user.phone_verified) {
        showGate(
          'Подтвердите телефон',
          'Чтобы пользоваться приложением, подтвердите номер телефона в чате с ботом кнопкой «Поделиться номером» — это защищает всех от фейковых анкет.',
          true
        );
        return;
      }
      if (!user.full_name) {
        showNameGate();
        return;
      }

      document.getElementById('adminTabBtn').hidden = !isAdmin;
      showTab('search');
    } catch (err) {
      toast(err.message);
    }
  }

  // init
  waitForInitData().then(initApp);
})();
