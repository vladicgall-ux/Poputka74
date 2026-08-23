(() => {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }
  const initData = tg?.initData ?? '';

  const state = {
    direction: { from: 'Челябинск', to: 'Кунашак' },
    me: null,
    driverProfile: null,
  };

  // ---------- API helper ----------
  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': initData,
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

  // ---------- Search tab ----------
  document.getElementById('directionSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('.dir-btn');
    if (!btn) return;
    document.querySelectorAll('.dir-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.direction = { from: btn.dataset.from, to: btn.dataset.to };
    loadRides();
  });

  function rideCardHtml(ride, opts = {}) {
    const full = ride.seats_available <= 0;
    const badge = ride.status === 'cancelled'
      ? '<span class="badge cancelled">Отменена</span>'
      : full
        ? '<span class="badge full">Мест нет</span>'
        : `<span class="badge ok">${ride.seats_available} мест свободно</span>`;
    const driverLine = ride.driver_first_name
      ? `<div class="driver-row">
          ${ride.photo_path ? `<img class="driver-avatar" src="/uploads/${ride.photo_path}" alt="" />` : ''}
          <div class="driver">${escapeHtml(ride.driver_first_name)} · ${escapeHtml(ride.car_model)}${ride.car_color ? ', ' + escapeHtml(ride.car_color) : ''} · ${escapeHtml(ride.car_plate)}</div>
        </div>`
      : '';
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
        ${ride.comment ? `<div class="comment">${escapeHtml(ride.comment)}</div>` : ''}
        ${actionHtml}
      </div>`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function loadRides() {
    const list = document.getElementById('ridesList');
    const empty = document.getElementById('ridesEmpty');
    list.innerHTML = '';
    try {
      const { rides } = await api(`/rides?from=${encodeURIComponent(state.direction.from)}&to=${encodeURIComponent(state.direction.to)}`);
      empty.hidden = rides.length > 0;
      list.innerHTML = rides.map((r) => rideCardHtml(r, {
        action: r.seats_available > 0
          ? `<button class="btn small book-btn" data-ride-id="${r.id}">Забронировать место</button>`
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
    btn.disabled = true;
    try {
      await api('/bookings', { method: 'POST', body: JSON.stringify({ rideId, seats: 1 }) });
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
        headers: { 'X-Telegram-Init-Data': initData },
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
  async function loadMineTab() {
    const ridesList = document.getElementById('myRidesList');
    const ridesEmpty = document.getElementById('myRidesEmpty');
    const bookingsList = document.getElementById('myBookingsList');
    const bookingsEmpty = document.getElementById('myBookingsEmpty');

    try {
      const { rides } = await api('/rides/mine');
      ridesEmpty.hidden = rides.length > 0;
      ridesList.innerHTML = rides.map((r) => rideCardHtml(r, {
        action: r.status === 'active'
          ? `<button class="btn secondary small cancel-ride-btn" data-ride-id="${r.id}">Отменить поездку</button>`
          : '',
      })).join('');
    } catch (err) {
      toast(err.message);
    }

    try {
      const { bookings } = await api('/bookings/mine');
      const active = bookings.filter((b) => b.status === 'pending' || b.status === 'confirmed');
      bookingsEmpty.hidden = active.length > 0;
      bookingsList.innerHTML = active.map((b) => `
        <div class="card ride-card">
          <div class="row">
            <div class="route">${escapeHtml(b.from_city)} → ${escapeHtml(b.to_city)}</div>
            <span class="badge ${b.status === 'confirmed' ? 'ok' : 'pending'}">${b.status === 'confirmed' ? 'подтверждена' : 'ждём водителя'} · ${b.seats_booked} мест</span>
          </div>
          <div class="meta">
            <span>🗓 ${formatDate(b.departure_at)}</span>
            <span class="price">${b.price_per_seat * b.seats_booked} ₽</span>
          </div>
          <button class="btn secondary small cancel-booking-btn" data-booking-id="${b.id}">Отменить бронь</button>
        </div>
      `).join('');
    } catch (err) {
      toast(err.message);
    }
  }

  document.getElementById('myRidesList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.cancel-ride-btn');
    if (!btn) return;
    if (!confirm('Отменить поездку?')) return;
    try {
      await api(`/rides/${btn.dataset.rideId}/cancel`, { method: 'POST' });
      toast('Поездка отменена');
      loadMineTab();
    } catch (err) {
      toast(err.message);
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
      const { user, driverProfile, isAdmin } = await api('/users/me');
      state.me = user;
      document.getElementById('adminTabBtn').hidden = !isAdmin;
      const card = document.getElementById('profileCard');
      card.innerHTML = `
        <div class="profile-row"><span class="label">Имя</span><span>${escapeHtml(user.first_name)}</span></div>
        <div class="profile-row"><span class="label">Username</span><span>${user.username ? '@' + escapeHtml(user.username) : '—'}</span></div>
        <div class="profile-row"><span class="label">Телефон</span><span>${user.phone_verified ? '✅ подтверждён' : '❌ не подтверждён'}</span></div>
        <div class="profile-row"><span class="label">Водитель</span><span>${driverProfile ? `✅ ${escapeHtml(driverProfile.car_model)}` : '—'}</span></div>
      `;
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- Admin tab ----------
  async function loadAdminTab() {
    try {
      const { users } = await api('/admin/users');
      document.getElementById('adminUsersList').innerHTML = users.map((u) => `
        <div class="card ride-card">
          <div class="row">
            <div class="route">${escapeHtml(u.first_name)}${u.username ? ' · @' + escapeHtml(u.username) : ''}</div>
            <span class="badge ${u.phone_verified ? 'ok' : 'cancelled'}">${u.phone_verified ? 'телефон подтверждён' : 'не подтверждён'}</span>
          </div>
          <div class="meta">
            <span>ID: ${u.telegram_id}</span>
            <span>${u.phone ? escapeHtml(u.phone) : 'номер не указан'}</span>
          </div>
          ${u.car_model ? `<div class="driver">Водитель: ${escapeHtml(u.car_model)} · ${escapeHtml(u.car_plate)}</div>` : ''}
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
  }

  // init
  showTab('search');
  api('/users/me').then(({ isAdmin }) => {
    document.getElementById('adminTabBtn').hidden = !isAdmin;
  }).catch(() => {});
})();
