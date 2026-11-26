// ใส่ URL ของ Apps Script web app (ลงท้ายด้วย /exec) — เว้นว่าง = โหมดตัวอย่าง เก็บข้อมูลในเบราว์เซอร์นี้เท่านั้น
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzC1R_m0CD-tL9_CU9mpqn6KGLmmUFq20EY3ZFCYnd0HPAdzbPAzSXeO_MoXjlExZaXmA/exec';
const DEMO = !SCRIPT_URL;
const OTHER = 'อื่นๆ'; // เลือกบริการนี้แล้วต้องพิมพ์ระบุ (ตรงกับ Code.gs)

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function getConfig() {
  if (DEMO) return Demo.config();
  const r = await fetch(SCRIPT_URL, { cache: 'no-store' });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d;
}

async function call(body) {
  if (DEMO) return Demo.call(body);
  // text/plain ไม่ทำให้เบราว์เซอร์ส่ง preflight ซึ่ง Apps Script ตอบไม่ได้
  const r = await fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d;
}

// ตัวเลือกบริการแบ่งตามหมวด (หมวดไม่มีชื่อ = ไม่ใส่ optgroup)
const serviceOptions = C => '<option value="">— เลือกบริการ —</option>' + C.serviceGroups.map(g => {
  const items = g.items.map(s => `<option>${esc(s)}</option>`).join('');
  return g.label ? `<optgroup label="${esc(g.label)}">${items}</optgroup>` : items;
}).join('');

// เลือก "อื่นๆ" → แสดงและบังคับช่องระบุ
function bindOther(select, box) {
  select.addEventListener('change', () => {
    box.hidden = select.value !== OTHER;
    box.querySelector('input').required = !box.hidden;
  });
}

const STATUSES = ['รอ', 'อยู่ระหว่างดำเนินการ', 'ดำเนินการเสร็จสิ้น', 'ยกเลิก']; // ตรงกับ Code.gs

// วันที่ yyyy-mm-dd → "พฤ. 26 พ.ย. 2569"
const thaiDate = d => new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.className = 'toast', 3500);
}

// shortcut: โหมดตัวอย่างตรวจแค่ช่องบังคับ ไม่ตรวจเต็มเท่า Code.gs — ใช้ดูหน้าตาก่อนต่อชีตจริงเท่านั้น
const Demo = {
  KEY: 'dt_demo_rows',
  rows() { try { return JSON.parse(localStorage.getItem(this.KEY)) || []; } catch { return []; } },
  save(r) { try { localStorage.setItem(this.KEY, JSON.stringify(r)); } catch {} },
  today: () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10),
  config() {
    const taken = {}, today = this.today();
    const board = this.rows().filter(r => r.date === today).map(r => ({ queue: r.queue, time: r.slot || r.created.slice(11, 16), status: r.status }));
    this.rows().filter(r => r.source === 'จองออนไลน์' && r.status !== 'ยกเลิก')
      .forEach(r => taken[r.date + '|' + r.slot] = (taken[r.date + '|' + r.slot] || 0) + 1);
    return {
      serviceGroups: [
        { label: '1. การโอนและรับโอนสิทธิ', items: ['ขาย / ขายฝาก / ไถ่ถอนจากการขายฝาก', 'ให้ / แลกเปลี่ยน', 'โอนมรดก / โอนตามคำสั่งศาล / โอนตามกฎหมาย'] },
        { label: '2. ภาระผูกพันและหลักประกัน', items: ['จำนอง / ไถ่ถอนจากจำนอง', 'ภาระจำยอม / สิทธิเก็บกิน / สิทธิอาศัย / สิทธิเหนือพื้นดิน', 'เช่าที่ดิน / เช่าอสังหาริมทรัพย์'] },
        { label: '3. ครอบครัวและการจัดการทรัพย์สิน', items: ['ลงชื่อคู่สมรส / แบ่งทรัพย์สินระหว่างคู่สมรส'] },
        { label: '4. รูปแปลง', items: ['รังวัดสอบเขต แบ่งแยก และรวมโฉนด', 'โอนเป็นที่สาธารณประโยชน์ / แบ่งหักเป็นที่สาธารณประโยชน์'] },
        { label: '5. อื่นๆ', items: [OTHER] }
      ],
      slots: ['08:30–10:00', '10:00–12:00', '13:00–14:30', '14:30–16:00'],
      perSlot: 5, daysAhead: 30, closedDates: [], today, taken, board
    };
  },
  call(b) {
    const rows = this.rows();
    const now = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
    if (b.action === 'login') return { token: 'demo' };
    if (b.action === 'list') return { rows: rows.filter(r => r.date === b.date) };
    if (b.action === 'status') {
      Object.assign(rows.find(r => r.id === b.id), { status: b.status, staffNote: b.staffNote || '', updated: now });
      this.save(rows);
      return { ok: true };
    }
    if (b.action === 'book' || b.action === 'add') {
      if (!b.name) throw new Error('กรุณากรอกชื่อ-สกุล');
      const id = Math.random().toString(36).slice(2, 8).toUpperCase(), date = b.date || this.today();
      const queue = rows.filter(r => r.date === date).reduce((m, r) => Math.max(m, r.queue), 0) + 1;
      rows.push({ id, queue, created: now, source: b.action === 'book' ? 'จองออนไลน์' : 'หน้างาน', date,
        slot: b.slot || '', name: b.name, phone: b.phone || '', plate: b.plate || '', service: b.service === OTHER ? OTHER + ': ' + b.other : b.service, note: b.note || '',
        status: 'รอ', staffNote: '', updated: now });
      this.save(rows);
      return { code: id, queue };
    }
    throw new Error('ไม่รู้จักคำสั่ง');
  }
};
