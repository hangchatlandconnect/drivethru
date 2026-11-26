// หน้าเจ้าหน้าที่: รายการรายวัน · เปลี่ยนสถานะ/หมายเหตุแล้วบันทึกทันที · บันทึกรับเรื่องหน้างาน
const TOKEN_KEY = 'dt_token';
let C, rows = [], busy = false;

const token = {
  get: () => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },
  set: v => { try { v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY); } catch {} }
};

// คำขอที่ต้องล็อกอิน: token หมด → กลับไปหน้าล็อกอิน
async function auth(body) {
  try {
    return await call({ ...body, token: token.get() });
  } catch (e) {
    if (/เข้าสู่ระบบ/.test(e.message)) { token.set(''); $('#app').hidden = true; $('#login').hidden = false; }
    throw e;
  }
}

(function start() {
  $('#demo').hidden = !DEMO;
  if (DEMO || token.get()) return openApp();
  $('#login').hidden = false;
  $('#lu').focus();
})();

$('#login').onsubmit = async e => {
  e.preventDefault();
  $('#lbtn').disabled = true;
  $('#lmsg').textContent = '';
  try {
    token.set((await call({ action: 'login', user: $('#lu').value, pass: $('#lp').value })).token);
    $('#lp').value = '';
    $('#login').hidden = true;
    openApp();
  } catch (err) {
    $('#lmsg').textContent = err.message;
  } finally {
    $('#lbtn').disabled = false;
  }
};

$('#logout').onclick = () => { token.set(''); location.reload(); };

async function openApp() {
  $('#app').hidden = false;
  $('#logout').hidden = DEMO;
  try {
    C = await getConfig();
  } catch (e) {
    return toast('โหลดตั้งค่าไม่สำเร็จ: ' + e.message, true);
  }
  $('#day').value = C.today;
  $('#aService').innerHTML = serviceOptions(C);
  bindOther($('#aService'), $('#aOtherBox'));
  load();
  setInterval(() => { if (!document.hidden && !busy && !$('#add').open) load(true); }, 60000);
}

async function load(quiet) {
  busy = true;
  try {
    rows = (await auth({ action: 'list', date: $('#day').value })).rows;
    render();
  } catch (e) {
    if (!quiet) toast(e.message, true);
  } finally {
    busy = false;
  }
}

function render() {
  // เรียงตามช่วงเวลา (หน้างานไม่มีช่วงเวลา → ใช้เวลาที่บันทึก) แล้วตามลำดับที่บันทึก
  const key = r => (r.slot || r.created.slice(11, 16)) + String(r.queue).padStart(4, '0');
  rows.sort((a, b) => key(a).localeCompare(key(b)));
  const n = s => rows.filter(r => r.status === s).length;
  $('#stats').innerHTML = [['ทั้งหมด', rows.length], ...STATUSES.map(s => [s, n(s)])]
    .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
  $('#rows').innerHTML = rows.length ? rows.map(r => `
    <tr data-id="${esc(r.id)}" class="st-${STATUSES.indexOf(r.status)}">
      <td class="qno">${esc(r.queue)}</td>
      <td class="mono">${esc(r.id)}</td>
      <td>${esc(r.slot || r.created.slice(11, 16) + ' น.')}</td>
      <td>${esc(r.name)}${r.phone ? `<br><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : ''}</td>
      <td>${esc(r.plate || '-')}</td>
      <td>${esc(r.service)}${r.note ? `<br><small>${esc(r.note)}</small>` : ''}</td>
      <td><span class="tag${r.source === 'หน้างาน' ? ' walk' : ''}">${esc(r.source)}</span></td>
      <td><div class="seg" role="group" aria-label="สถานะคิวที่ ${esc(r.queue)}">${STATUSES.map((s, i) =>
        `<button type="button" class="s${i}" data-s="${s}" aria-pressed="${s === r.status}">${s}</button>`).join('')}</div></td>
      <td><input aria-label="หมายเหตุเจ้าหน้าที่ของ ${esc(r.id)}" value="${esc(r.staffNote)}" maxlength="500"></td>
    </tr>`).join('') : '<tr><td colspan="9" class="none">ยังไม่มีรายการในวันนี้</td></tr>';
}

// กดปุ่มสถานะ หรือแก้หมายเหตุ → บันทึกทันที
$('#rows').onclick = e => {
  const btn = e.target.closest('.seg button');
  if (btn && btn.getAttribute('aria-pressed') !== 'true') save(btn.closest('tr'), btn.dataset.s);
};
$('#rows').onchange = e => { if (e.target.matches('input')) save(e.target.closest('tr')); };

async function save(tr, status) {
  const r = rows.find(x => x.id === tr.dataset.id);
  const next = { status: status || r.status, staffNote: tr.querySelector('input').value };
  busy = true;
  try {
    await auth({ action: 'status', id: r.id, ...next });
    Object.assign(r, next);
    toast(`คิวที่ ${r.queue}: ${next.status}`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    busy = false;
    render();
  }
}

$('#day').onchange = () => load();
$('#reload').onclick = () => load();

$('#addOpen').onclick = () => { $('#addForm').reset(); $('#aOtherBox').hidden = true; $('#aErr').textContent = ''; $('#add').showModal(); };
$('#aClose').onclick = () => $('#add').close();
$('#addForm').onsubmit = async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const phone = f.phone.replace(/\D/g, '');
  const why = !f.name.trim() ? 'กรุณากรอกชื่อ-สกุล' : !f.service ? 'กรุณาเลือกบริการ' : f.service === OTHER && !f.other.trim() ? 'กรุณาระบุบริการ' : phone && !/^0\d{8,9}$/.test(phone) ? 'เบอร์โทรศัพท์ไม่ถูกต้อง' : '';
  $('#aErr').textContent = why;
  if (why) return;
  $('#aBtn').disabled = true;
  try {
    const { queue } = await auth({ action: 'add', ...f, date: $('#day').value });
    $('#add').close();
    toast('บันทึกแล้ว คิวที่ ' + queue);
    load();
  } catch (err) {
    $('#aErr').textContent = err.message;
  } finally {
    $('#aBtn').disabled = false;
  }
};
