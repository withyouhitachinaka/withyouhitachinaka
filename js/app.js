'use strict';

(() => {
  const STORAGE_KEY = 'sougei-data-v1';
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const TYPES = { pickup: 'お迎え', dropoff: 'お送り' };
  const UNASSIGNED = '';

  // ---------- データ ----------

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  function sampleData() {
    const v1 = uid(), v2 = uid();
    const s1 = uid(), s2 = uid(), s3 = uid();
    const user = (name, days, pickupPlace, pickupTime, dropoffPlace, dropoffTime, vehicleId, note = '') => ({
      id: uid(), name, phone: '', days, note, vehicleId,
      pickupPlace, pickupTime, dropoffPlace, dropoffTime,
    });
    return {
      vehicles: [
        { id: v1, name: '1号車', capacity: 7 },
        { id: v2, name: '2号車', capacity: 4 },
      ],
      staff: [
        { id: s1, name: '職員A', canDrive: true },
        { id: s2, name: '職員B', canDrive: true },
        { id: s3, name: '職員C', canDrive: false },
      ],
      users: [
        user('利用者 一郎', [1, 3, 5], '○○小学校', '14:30', '自宅', '17:00', v1),
        user('利用者 花子', [1, 2, 3, 4, 5], '○○小学校', '14:30', '自宅', '17:15', v1),
        user('利用者 次郎', [2, 4], '△△特別支援学校', '15:00', '自宅', '17:30', v2, '車いす'),
        user('利用者 三郎', [6], '自宅', '09:30', '自宅', '16:00', v2),
      ],
      days: {},
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) {
      console.error(e);
    }
    return sampleData();
  }

  function normalize(d) {
    return {
      vehicles: Array.isArray(d.vehicles) ? d.vehicles : [],
      staff: Array.isArray(d.staff) ? d.staff : [],
      users: Array.isArray(d.users) ? d.users : [],
      days: d.days && typeof d.days === 'object' ? d.days : {},
    };
  }

  let data = load();
  let currentDate = toISO(new Date());

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      alert('保存に失敗しました: ' + e.message);
    }
  }

  function day(date = currentDate) {
    if (!data.days[date]) data.days[date] = { entries: [], crews: {}, absent: [] };
    return data.days[date];
  }

  function cleanupDay(date) {
    const d = data.days[date];
    if (d && !d.entries.length && !d.absent.length && !Object.keys(d.crews).length) delete data.days[date];
  }

  const findUser = (id) => data.users.find((u) => u.id === id);
  const findVehicle = (id) => data.vehicles.find((v) => v.id === id);
  const findStaff = (id) => data.staff.find((s) => s.id === id);

  // ---------- ユーティリティ ----------

  function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function fromISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDate(iso) {
    const dt = fromISO(iso);
    return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日（${WEEKDAYS[dt.getDay()]}）`;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  const $ = (sel, root = document) => root.querySelector(sel);

  const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99');

  function options(list, selected, emptyLabel) {
    const opts = emptyLabel !== undefined ? [`<option value="">${esc(emptyLabel)}</option>`] : [];
    for (const item of list) {
      opts.push(`<option value="${esc(item.id)}"${item.id === selected ? ' selected' : ''}>${esc(item.name)}</option>`);
    }
    return opts.join('');
  }

  // ---------- 画面切替 ----------

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  });

  function showView(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === name));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${name}`));
    render();
  }

  function render() {
    renderSchedule();
    renderUsers();
    renderResources();
  }

  // ---------- 送迎表 ----------

  const dateInput = $('#date');

  function setDate(iso) {
    currentDate = iso;
    dateInput.value = iso;
    renderSchedule();
  }

  function shiftDate(n) {
    const dt = fromISO(currentDate);
    dt.setDate(dt.getDate() + n);
    setDate(toISO(dt));
  }

  dateInput.addEventListener('change', () => dateInput.value && setDate(dateInput.value));
  $('#prev-day').addEventListener('click', () => shiftDate(-1));
  $('#next-day').addEventListener('click', () => shiftDate(1));
  $('#today').addEventListener('click', () => setDate(toISO(new Date())));
  $('#print').addEventListener('click', () => window.print());

  $('#generate').addEventListener('click', () => {
    const wd = fromISO(currentDate).getDay();
    const d = day();
    let added = 0;
    for (const u of data.users) {
      if (!(u.days || []).includes(wd)) continue;
      for (const type of Object.keys(TYPES)) {
        if (d.entries.some((e) => e.userId === u.id && e.type === type)) continue;
        d.entries.push(newEntry(u, type));
        added++;
      }
    }
    cleanupDay(currentDate);
    save();
    renderSchedule();
    if (!added) alert(`${WEEKDAYS[wd]}曜日の利用予定で、追加する利用者はいませんでした。`);
  });

  $('#clear-day').addEventListener('click', () => {
    if (!data.days[currentDate]) return;
    if (!confirm(`${formatDate(currentDate)} の送迎表をすべて削除しますか？`)) return;
    delete data.days[currentDate];
    save();
    renderSchedule();
  });

  function newEntry(u, type) {
    const vehicleId = findVehicle(u.vehicleId) ? u.vehicleId : UNASSIGNED;
    return {
      id: uid(),
      userId: u.id,
      type,
      vehicleId,
      time: type === 'pickup' ? u.pickupTime || '' : u.dropoffTime || '',
      place: type === 'pickup' ? u.pickupPlace || '' : u.dropoffPlace || '',
      note: '',
    };
  }

  function renderSchedule() {
    dateInput.value = currentDate;
    const d = data.days[currentDate] || { entries: [], crews: {}, absent: [] };
    const absent = new Set(d.absent);

    $('#print-title').textContent = `送迎表　${formatDate(currentDate)}`;

    const count = (type) => d.entries.filter((e) => e.type === type && !absent.has(e.userId)).length;
    $('#summary').textContent = d.entries.length
      ? `お迎え ${count('pickup')}名 ／ お送り ${count('dropoff')}名${absent.size ? ` ／ 欠席 ${absent.size}名` : ''}`
      : 'この日の送迎はまだ登録されていません。「利用予定から作成」で利用者の曜日設定から自動作成できます。';

    const absentNames = d.absent.map((id) => findUser(id)).filter(Boolean);
    $('#absent-box').innerHTML = absentNames.length
      ? `<strong>欠席：</strong>` + absentNames.map((u) =>
        `<span class="chip">${esc(u.name)}<button class="no-print" data-action="unabsent" data-user="${esc(u.id)}" title="欠席を取消">×</button></span>`).join('')
      : '';

    for (const type of Object.keys(TYPES)) {
      $(`#board-${type}`).innerHTML = renderBoard(d, type, absent);
    }
  }

  function renderBoard(d, type, absent) {
    const entries = d.entries.filter((e) => e.type === type);
    const columns = [...data.vehicles];
    const hasUnassigned = entries.some((e) => !findVehicle(e.vehicleId));
    const cards = columns.map((v) => renderCard(d, type, v, entries.filter((e) => e.vehicleId === v.id), absent));
    if (hasUnassigned || !columns.length) {
      cards.push(renderCard(d, type, null, entries.filter((e) => !findVehicle(e.vehicleId)), absent));
    }
    return cards.join('');
  }

  function renderCard(d, type, vehicle, entries, absent) {
    const vid = vehicle ? vehicle.id : UNASSIGNED;
    const crew = d.crews[`${type}:${vid}`] || {};
    const riding = entries.filter((e) => !absent.has(e.userId)).length;
    const over = vehicle && riding > vehicle.capacity;
    const drivers = data.staff.filter((s) => s.canDrive);
    const already = new Set(d.entries.filter((e) => e.type === type).map((e) => e.userId));
    const addable = data.users.filter((u) => !already.has(u.id));

    const rows = entries.slice().sort(byTime).map((e) => {
      const u = findUser(e.userId);
      const isAbsent = absent.has(e.userId);
      return `
        <tr class="${isAbsent ? 'absent' : ''}" data-entry="${esc(e.id)}">
          <td><input type="time" data-field="time" value="${esc(e.time)}" aria-label="時刻"></td>
          <td class="name">
            ${esc(u ? u.name : '（削除された利用者）')}
            ${u && u.note ? `<small>${esc(u.note)}</small>` : ''}
            ${isAbsent ? '<small class="tag">欠席</small>' : ''}
          </td>
          <td><input data-field="place" value="${esc(e.place)}" placeholder="場所" aria-label="場所"></td>
          <td><input data-field="note" value="${esc(e.note)}" placeholder="メモ" aria-label="メモ"></td>
          <td class="row-actions no-print">
            <select data-field="vehicleId" aria-label="車両を変更">${options(data.vehicles, e.vehicleId, '未割当')}</select>
            <button data-action="absent" data-user="${esc(e.userId)}" title="${isAbsent ? '欠席を取消' : '欠席にする'}">${isAbsent ? '出席' : '欠席'}</button>
            <button data-action="remove" title="この送迎を削除">×</button>
          </td>
        </tr>`;
    }).join('');

    return `
      <article class="card${vehicle ? '' : ' unassigned'}${over ? ' over' : ''}" data-type="${type}" data-vehicle="${esc(vid)}">
        <header>
          <h4>${vehicle ? esc(vehicle.name) : '未割当'}</h4>
          <span class="count">${riding}${vehicle ? ` / ${vehicle.capacity}` : ''}名${over ? ' 定員超過' : ''}</span>
        </header>
        ${vehicle ? `
        <div class="crew">
          <label>運転<select data-crew="driverId">${options(drivers, crew.driverId, '—')}</select></label>
          <label>添乗<select data-crew="escortId">${options(data.staff, crew.escortId, '—')}</select></label>
        </div>` : ''}
        <table class="stops">
          <thead><tr><th>時刻</th><th>利用者</th><th>場所</th><th>メモ</th><th class="no-print"></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="empty">送迎なし</td></tr>`}</tbody>
        </table>
        ${addable.length ? `
        <div class="add-row no-print">
          <select data-action="add" aria-label="利用者を追加">
            <option value="">＋ 利用者を追加…</option>
            ${addable.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}
          </select>
        </div>` : ''}
      </article>`;
  }

  function onBoardChange(ev) {
    const t = ev.target;
    const card = t.closest('.card');
    if (!card) return;
    const type = card.dataset.type;
    const vid = card.dataset.vehicle;
    const d = day();

    if (t.dataset.crew) {
      const key = `${type}:${vid}`;
      d.crews[key] = { ...(d.crews[key] || {}), [t.dataset.crew]: t.value };
      if (!d.crews[key].driverId && !d.crews[key].escortId) delete d.crews[key];
    } else if (t.dataset.action === 'add') {
      const u = findUser(t.value);
      if (!u) return;
      const e = newEntry(u, type);
      e.vehicleId = vid;
      d.entries.push(e);
    } else if (t.dataset.field) {
      const e = d.entries.find((x) => x.id === t.closest('tr').dataset.entry);
      if (!e) return;
      e[t.dataset.field] = t.value;
    } else {
      return;
    }
    cleanupDay(currentDate);
    save();
    renderSchedule();
  }

  function onScheduleClick(ev) {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const d = day();
    const action = btn.dataset.action;
    if (action === 'remove') {
      const id = btn.closest('tr').dataset.entry;
      d.entries = d.entries.filter((e) => e.id !== id);
    } else if (action === 'absent' || action === 'unabsent') {
      const userId = btn.dataset.user;
      d.absent = d.absent.includes(userId) ? d.absent.filter((x) => x !== userId) : [...d.absent, userId];
    } else {
      return;
    }
    cleanupDay(currentDate);
    save();
    renderSchedule();
  }

  ['pickup', 'dropoff'].forEach((type) => {
    $(`#board-${type}`).addEventListener('change', onBoardChange);
  });
  $('#view-schedule').addEventListener('click', onScheduleClick);

  // ---------- 利用者 ----------

  const userDialog = $('#user-dialog');
  const userForm = $('#user-form');

  $('#weekday-checks').innerHTML = WEEKDAYS.map((w, i) =>
    `<label class="check"><input type="checkbox" name="days" value="${i}"> ${w}</label>`).join('');

  function renderUsers() {
    const rows = data.users.map((u) => {
      const v = findVehicle(u.vehicleId);
      const days = WEEKDAYS.map((w, i) => `<span class="wd${(u.days || []).includes(i) ? ' on' : ''}">${w}</span>`).join('');
      return `
        <tr data-user="${esc(u.id)}">
          <td><strong>${esc(u.name)}</strong>${u.phone ? `<br><small>${esc(u.phone)}</small>` : ''}</td>
          <td class="wds">${days}</td>
          <td>${esc(u.pickupTime)} ${esc(u.pickupPlace)}</td>
          <td>${esc(u.dropoffTime)} ${esc(u.dropoffPlace)}</td>
          <td>${v ? esc(v.name) : '—'}</td>
          <td>${esc(u.note)}</td>
          <td class="row-actions">
            <button data-action="edit">編集</button>
            <button data-action="delete">削除</button>
          </td>
        </tr>`;
    }).join('');
    $('#user-rows').innerHTML = rows || '<tr><td colspan="7" class="empty">利用者が登録されていません。</td></tr>';
  }

  function openUserDialog(u) {
    userForm.reset();
    $('#user-dialog-title').textContent = u ? '利用者を編集' : '利用者を追加';
    userForm.vehicleId.innerHTML = options(data.vehicles, u?.vehicleId, '未設定');
    const f = userForm.elements;
    f.id.value = u?.id || '';
    for (const k of ['name', 'phone', 'pickupPlace', 'pickupTime', 'dropoffPlace', 'dropoffTime', 'note']) {
      f[k].value = u?.[k] || '';
    }
    userForm.querySelectorAll('input[name="days"]').forEach((cb) => {
      cb.checked = (u?.days || []).includes(Number(cb.value));
    });
    userDialog.showModal();
  }

  $('#add-user').addEventListener('click', () => openUserDialog(null));
  $('#user-cancel').addEventListener('click', () => userDialog.close());

  userForm.addEventListener('submit', () => {
    const f = userForm.elements;
    const values = {
      name: f.name.value.trim(),
      phone: f.phone.value.trim(),
      pickupPlace: f.pickupPlace.value.trim(),
      pickupTime: f.pickupTime.value,
      dropoffPlace: f.dropoffPlace.value.trim(),
      dropoffTime: f.dropoffTime.value,
      vehicleId: f.vehicleId.value,
      note: f.note.value.trim(),
      days: [...userForm.querySelectorAll('input[name="days"]:checked')].map((cb) => Number(cb.value)),
    };
    const existing = findUser(f.id.value);
    if (existing) Object.assign(existing, values);
    else data.users.push({ id: uid(), ...values });
    save();
    render();
  });

  $('#user-rows').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const u = findUser(btn.closest('tr').dataset.user);
    if (!u) return;
    if (btn.dataset.action === 'edit') {
      openUserDialog(u);
    } else if (btn.dataset.action === 'delete') {
      if (!confirm(`「${u.name}」を削除しますか？\n登録済みの送迎表からも削除されます。`)) return;
      data.users = data.users.filter((x) => x.id !== u.id);
      for (const [date, d] of Object.entries(data.days)) {
        d.entries = d.entries.filter((e) => e.userId !== u.id);
        d.absent = d.absent.filter((x) => x !== u.id);
        cleanupDay(date);
      }
      save();
      render();
    }
  });

  // ---------- 車両・職員 ----------

  function renderResources() {
    $('#vehicle-list').innerHTML = data.vehicles.map((v) => `
      <li data-id="${esc(v.id)}">
        <input data-field="name" value="${esc(v.name)}" aria-label="車両名">
        <label>定員<input data-field="capacity" type="number" min="1" max="30" value="${esc(v.capacity)}"></label>
        <button data-action="delete">削除</button>
      </li>`).join('') || '<li class="empty">車両が登録されていません。</li>';

    $('#staff-list').innerHTML = data.staff.map((s) => `
      <li data-id="${esc(s.id)}">
        <input data-field="name" value="${esc(s.name)}" aria-label="氏名">
        <label class="check"><input data-field="canDrive" type="checkbox"${s.canDrive ? ' checked' : ''}> 運転可</label>
        <button data-action="delete">削除</button>
      </li>`).join('') || '<li class="empty">職員が登録されていません。</li>';
  }

  $('#vehicle-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target.elements;
    data.vehicles.push({ id: uid(), name: f.name.value.trim(), capacity: Number(f.capacity.value) || 1 });
    ev.target.reset();
    save();
    render();
  });

  $('#staff-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target.elements;
    data.staff.push({ id: uid(), name: f.name.value.trim(), canDrive: f.canDrive.checked });
    ev.target.reset();
    f.canDrive.checked = true;
    save();
    render();
  });

  function bindResourceList(listSel, key, onDelete) {
    const list = $(listSel);
    list.addEventListener('change', (ev) => {
      const t = ev.target;
      const item = data[key].find((x) => x.id === t.closest('li')?.dataset.id);
      if (!item || !t.dataset.field) return;
      if (t.type === 'checkbox') item[t.dataset.field] = t.checked;
      else if (t.type === 'number') item[t.dataset.field] = Math.max(1, Number(t.value) || 1);
      else if (t.value.trim()) item[t.dataset.field] = t.value.trim();
      save();
      render();
    });
    list.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-action="delete"]');
      if (!btn) return;
      const item = data[key].find((x) => x.id === btn.closest('li').dataset.id);
      if (!item || !confirm(`「${item.name}」を削除しますか？`)) return;
      data[key] = data[key].filter((x) => x.id !== item.id);
      onDelete(item.id);
      save();
      render();
    });
  }

  bindResourceList('#vehicle-list', 'vehicles', (id) => {
    for (const u of data.users) if (u.vehicleId === id) u.vehicleId = UNASSIGNED;
    for (const d of Object.values(data.days)) {
      for (const e of d.entries) if (e.vehicleId === id) e.vehicleId = UNASSIGNED;
      for (const k of Object.keys(d.crews)) if (k.endsWith(`:${id}`)) delete d.crews[k];
    }
  });

  bindResourceList('#staff-list', 'staff', (id) => {
    for (const d of Object.values(data.days)) {
      for (const c of Object.values(d.crews)) {
        if (c.driverId === id) c.driverId = '';
        if (c.escortId === id) c.escortId = '';
      }
    }
  });

  // ---------- データ ----------

  $('#export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sougei-${toISO(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#import').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const imported = normalize(JSON.parse(await file.text()));
      if (!confirm('現在のデータを読み込んだファイルの内容で置き換えますか？')) return;
      data = imported;
      save();
      render();
      alert('読み込みました。');
    } catch (e) {
      alert('ファイルを読み込めませんでした: ' + e.message);
    }
  });

  $('#reset').addEventListener('click', () => {
    if (!confirm('すべてのデータを削除してサンプルデータに戻しますか？この操作は元に戻せません。')) return;
    data = sampleData();
    save();
    render();
  });

  // ---------- 起動 ----------

  render();
})();
