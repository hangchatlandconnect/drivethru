// หน้าประชาชน: เลือกวัน → ช่วงเวลาที่ยังว่าง → กรอกข้อมูล → ได้รหัสจอง (Code.gs ตรวจซ้ำทุกข้อ)
let C;
const form = $('#book');

const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
function closedReason(d) {
  const wd = new Date(d + 'T00:00:00Z').getUTCDay();
  if (d < C.today || d > addDays(C.today, C.daysAhead)) return `จองได้ตั้งแต่วันนี้ถึง ${C.daysAhead} วันข้างหน้า`;
  if (wd === 0 || wd === 6 || C.closedDates.includes(d)) return 'วันที่เลือกเป็นวันหยุดราชการ กรุณาเลือกวันอื่น';
  return '';
}

(async function start() {
  $('#demo').hidden = !DEMO;
  try {
    C = await getConfig();
  } catch (e) {
    $('#err').textContent = 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่ (' + e.message + ')';
    $('#submit').disabled = true;
    return;
  }
  $('#date').min = C.today;
  $('#date').max = addDays(C.today, C.daysAhead);
  renderBoard();
  setInterval(refresh, 30000);
  $('#service').innerHTML = serviceOptions(C);
  bindOther($('#service'), $('#otherBox'));
})();

// กระดานคิว วันนี้ + วันถัดไปที่มีคนจอง: เลขคิว เวลา สถานะ เท่านั้น — ไม่มีข้อมูลส่วนบุคคล
function renderBoard() {
  const key = x => x.date + x.time + String(x.queue).padStart(4, '0');
  const q = C.board.map(x => ({ date: C.today, ...x })).sort((a, b) => key(a).localeCompare(key(b)));
  const serving = q.filter(x => x.date === C.today && x.status === STATUSES[1]).map(x => x.queue);
  $('#now').innerHTML = serving.length ? `กำลังดำเนินการ: คิวที่ <b>${serving.join(', ')}</b>` : 'ยังไม่มีคิวที่กำลังดำเนินการ';
  const days = [C.today, ...new Set(q.map(x => x.date).filter(d => d !== C.today))];
  $('#board').innerHTML = days.map(d => {
    const items = q.filter(x => x.date === d);
    return `<h3 class="day">${d === C.today ? 'วันนี้ · ' : ''}${thaiDate(d)}</h3><ol class="queue">${items.length
      ? items.map(x => `<li class="st-${STATUSES.indexOf(x.status)}"><b>${x.queue}</b><span>${esc(x.time)}</span><em>${esc(x.status)}</em></li>`).join('')
      : '<li class="empty">ยังไม่มีคิววันนี้</li>'}</ol>`;
  }).join('');
}

async function refresh() {
  if (document.hidden) return;
  try {
    C = await getConfig();
    renderBoard();
  } catch {} // พลาดรอบนี้ ไว้รอบหน้า
}

$('#date').onchange = () => {
  const d = $('#date').value, why = d && closedReason(d);
  $('#err').textContent = why || '';
  $('#slot').innerHTML = !d || why ? '<option value="">— เลือกวันที่ก่อน —</option>'
    : '<option value="">— เลือกช่วงเวลา —</option>' + C.slots.map(s => {
      const left = C.perSlot - (C.taken[d + '|' + s] || 0);
      return `<option value="${esc(s)}"${left > 0 ? '' : ' disabled'}>${esc(s)} น. · ${left > 0 ? 'ว่าง ' + left + ' คิว' : 'เต็ม'}</option>`;
    }).join('');
};

form.onsubmit = async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const why = !f.date ? 'กรุณาเลือกวันที่' : closedReason(f.date) || (!f.slot ? 'กรุณาเลือกช่วงเวลา' : !f.service ? 'กรุณาเลือกบริการ' : f.service === OTHER && !f.other.trim() ? 'กรุณาระบุบริการที่ต้องการ'
    : !f.name.trim() ? 'กรุณากรอกชื่อ-สกุล' : !/^0\d{8,9}$/.test(f.phone.replace(/\D/g, '')) ? 'เบอร์โทรศัพท์ไม่ถูกต้อง (ตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0)'
    : !f.consent ? 'กรุณายินยอมให้ใช้ข้อมูลเพื่อการนัดหมาย' : '');
  $('#err').textContent = why;
  if (why) return;
  $('#submit').disabled = true;
  try {
    const { code, queue } = await call({ action: 'book', ...f, consent: true });
    $('#queue').textContent = queue;
    refresh();
    $('#code').textContent = code;
    $('#summary').innerHTML = [['วันที่', thaiDate(f.date)], ['เวลา', f.slot + ' น.'], ['บริการ', f.service === OTHER ? OTHER + ': ' + f.other : f.service], ['ชื่อ', f.name], ['ทะเบียนรถ', f.plate || '-']]
      .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
    form.hidden = true;
    $('#done').hidden = false;
    $('#done').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    $('#err').textContent = err.message;
  } finally {
    $('#submit').disabled = false;
  }
};

$('#again').onclick = () => location.reload();
