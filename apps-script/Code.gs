/**
 * Drive-Thru สำนักงานที่ดินจังหวัดลำปาง สาขาห้างฉัตร — หลังบ้านบน Google Sheet
 * วางทั้งไฟล์นี้ใน Apps Script ของชีต (ส่วนขยาย → Apps Script)
 *
 *   GET                                         → ตั้งค่า + จำนวนคิวที่จองแล้วต่อช่วงเวลา + กระดานคิววันนี้ (ไม่มีข้อมูลส่วนบุคคล)
 *   POST {action:'book', ...ฟอร์ม}              → ประชาชนจองคิว → {code}
 *   POST {action:'login', user, pass}           → {token} ใช้ได้ 8 ชม.
 *   POST {action:'list', token, date}           → รายการของวันนั้น (เฉพาะเจ้าหน้าที่)
 *   POST {action:'add', token, ...ฟอร์ม}        → เจ้าหน้าที่บันทึกรับเรื่องหน้างาน
 *   POST {action:'status', token, id, status, staffNote} → เปลี่ยนสถานะ
 *
 * ครั้งแรก: รัน setup() → รัน setPassword() → Deploy เป็น Web app (Execute as: Me, Who has access: Anyone)
 */

const SHEET_REQ = 'รายการ';
const SHEET_SET = 'ตั้งค่า';
const COLS = ['id', 'created', 'source', 'date', 'slot', 'name', 'phone', 'plate', 'service', 'note', 'status', 'staffNote', 'updated', 'queue'];
const HEAD = ['รหัส', 'บันทึกเมื่อ', 'ช่องทาง', 'วันที่', 'ช่วงเวลา', 'ชื่อ-สกุล', 'โทรศัพท์', 'ทะเบียนรถ', 'บริการ', 'หมายเหตุ', 'สถานะ', 'หมายเหตุเจ้าหน้าที่', 'แก้ไขล่าสุด', 'ลำดับคิว'];
const STATUSES = ['รอ', 'กำลังให้บริการ', 'เสร็จสิ้น', 'ยกเลิก'];
const TZ = 'Asia/Bangkok';
const OTHER = 'อื่นๆ'; // เลือกบริการนี้แล้วต้องพิมพ์ระบุ
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_FAILS = 5;          // รหัสผิดเกิน 5 ครั้งใน 15 นาที → ล็อก
const MAX_BOOK_PER_MIN = 20;  // กันสแปมทั้งระบบ
const DEFAULTS = [
  ['services', '# 1. การโอนและรับโอนสิทธิ\nขาย / ขายฝาก / ไถ่ถอนจากการขายฝาก\nให้ / แลกเปลี่ยน\nโอนมรดก / โอนตามคำสั่งศาล / โอนตามกฎหมาย\n# 2. ภาระผูกพันและหลักประกัน\nจำนอง / ไถ่ถอนจากจำนอง\nภาระจำยอม / สิทธิเก็บกิน / สิทธิอาศัย / สิทธิเหนือพื้นดิน\nเช่าที่ดิน / เช่าอสังหาริมทรัพย์\n# 3. ครอบครัวและการจัดการทรัพย์สิน\nลงชื่อคู่สมรส / แบ่งทรัพย์สินระหว่างคู่สมรส\n# 4. รูปแปลง\nรังวัดสอบเขต แบ่งแยก และรวมโฉนด\nโอนเป็นที่สาธารณประโยชน์ / แบ่งหักเป็นที่สาธารณประโยชน์\n# 5. อื่นๆ\nอื่นๆ', 'บรรทัดละ 1 บริการ · บรรทัดที่ขึ้นต้นด้วย # คือชื่อหมวด · "อื่นๆ" = ให้ผู้จองพิมพ์ระบุเอง'],
  ['slots', '08:30–10:00\n10:00–12:00\n13:00–14:30\n14:30–16:00', 'ช่วงเวลารับจอง บรรทัดละ 1 ช่วง'],
  ['perSlot', '5', 'รับจองได้กี่คันต่อช่วงเวลา'],
  ['daysAhead', '30', 'จองล่วงหน้าได้กี่วัน'],
  ['closedDates', '', 'วันหยุดราชการ ไม่รับจอง: ปี ค.ศ. เช่น 2026-12-05 บรรทัดละวัน'],
];

// ---------- อ่าน (สาธารณะ) ----------
function doGet() {
  try {
    const s = settings_();
    const today = today_();
    const taken = {}, board = [];
    rows_().forEach(r => {
      if (r.date === today) board.push({ queue: Number(r.queue) || 0, time: r.slot || r.created.slice(11, 16), status: r.status });
      if (r.source === 'จองออนไลน์' && r.date >= today && r.status !== 'ยกเลิก') {
        const k = r.date + '|' + r.slot;
        taken[k] = (taken[k] || 0) + 1;
      }
    });
    return json_({ services: s.services, serviceGroups: s.serviceGroups, slots: s.slots, perSlot: s.perSlot, daysAhead: s.daysAhead,
      closedDates: s.closedDates, today: today, taken: taken, board: board });
  } catch (err) {
    return json_({ error: err.message });
  }
}

function settings_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_SET);
  const m = {};
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => m[r[0]] = String(r[1]));
  // services: "# ชื่อหมวด" ตามด้วยบริการในหมวด บรรทัดละ 1
  const serviceGroups = [];
  lines_(m.services).forEach(l => {
    if (l[0] === '#') serviceGroups.push({ label: l.replace(/^#+\s*/, ''), items: [] });
    else {
      if (!serviceGroups.length) serviceGroups.push({ label: '', items: [] });
      serviceGroups[serviceGroups.length - 1].items.push(l);
    }
  });
  return {
    services: [].concat.apply([], serviceGroups.map(x => x.items)), serviceGroups: serviceGroups, slots: lines_(m.slots),
    perSlot: Math.max(1, Number(m.perSlot) || 5), daysAhead: Math.max(1, Number(m.daysAhead) || 30),
    closedDates: lines_(m.closedDates)
  };
}

function rows_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_REQ);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, COLS.length).getDisplayValues().map(r => {
    const o = {};
    COLS.forEach((c, i) => o[c] = r[i]);
    return o;
  });
}

function lines_(v) {
  return String(v || '').split(/\n+/).map(x => x.trim()).filter(String);
}

// ---------- เขียน ----------
function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.action === 'book') return json_(book_(b));
    if (b.action === 'login') return json_({ token: login_(b.user, b.pass) });
    if (!validToken_(b.token)) throw new Error('หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่');
    if (b.action === 'list') return json_({ rows: rows_().filter(r => r.date === String(b.date)) });
    if (b.action === 'add') return json_(add_(b));
    if (b.action === 'status') return json_({ ok: setStatus_(b) });
    throw new Error('ไม่รู้จักคำสั่ง');
  } catch (err) {
    return json_({ error: err.message });
  }
}

function book_(b) {
  if (b.website) throw new Error('ส่งข้อมูลไม่สำเร็จ'); // ช่องกับดักบอต — คนจริงไม่เห็นช่องนี้
  if (b.consent !== true) throw new Error('กรุณายินยอมให้ใช้ข้อมูลเพื่อการนัดหมาย');
  const s = settings_();
  const f = form_(b, s, true);
  const err = dateError_(f.date, s);
  if (err) throw new Error(err);
  if (s.slots.indexOf(f.slot) < 0) throw new Error('กรุณาเลือกช่วงเวลา');

  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('book_min') || 0);
  if (n >= MAX_BOOK_PER_MIN) throw new Error('มีผู้จองจำนวนมาก กรุณาลองใหม่ในอีก 1 นาที');
  cache.put('book_min', String(n + 1), 60);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const active = rows_().filter(r => r.date === f.date && r.status !== 'ยกเลิก');
    if (active.some(r => r.phone === f.phone && r.source === 'จองออนไลน์'))
      throw new Error('เบอร์นี้จองวันนี้ไว้แล้ว หากต้องการเปลี่ยนกรุณาโทรแจ้งสำนักงาน');
    if (active.filter(r => r.slot === f.slot && r.source === 'จองออนไลน์').length >= s.perSlot)
      throw new Error('ช่วงเวลานี้เต็มแล้ว กรุณาเลือกช่วงอื่น');
    return append_('จองออนไลน์', f);
  } finally {
    lock.releaseLock();
  }
}

function add_(b) {
  const s = settings_();
  const f = form_(b, s, false);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) f.date = today_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return append_('หน้างาน', f);
  } finally {
    lock.releaseLock();
  }
}

// ตรวจและตัดข้อความจากฟอร์ม — needPhone: ประชาชนต้องใส่เบอร์ เจ้าหน้าที่ไม่บังคับ
function form_(b, s, needPhone) {
  const f = {
    date: String(b.date || '').trim(), slot: String(b.slot || '').trim(),
    name: String(b.name || '').trim().slice(0, 100), phone: String(b.phone || '').replace(/\D/g, ''),
    plate: String(b.plate || '').trim().slice(0, 20), service: String(b.service || '').trim(),
    note: String(b.note || '').trim().slice(0, 500)
  };
  if (!f.name) throw new Error('กรุณากรอกชื่อ-สกุล');
  if ((needPhone || f.phone) && !/^0\d{8,9}$/.test(f.phone)) throw new Error('เบอร์โทรศัพท์ไม่ถูกต้อง (ตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0)');
  if (s.services.indexOf(f.service) < 0) throw new Error('กรุณาเลือกบริการ');
  if (f.service === OTHER) {
    const other = String(b.other || '').trim().slice(0, 200);
    if (!other) throw new Error('กรุณาระบุบริการที่ต้องการ');
    f.service = OTHER + ': ' + other;
  }
  return f;
}

function dateError_(d, s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'กรุณาเลือกวันที่';
  const today = today_();
  if (d < today) return 'เลือกวันที่ผ่านมาแล้วไม่ได้';
  if (d > addDays_(today, s.daysAhead)) return 'จองล่วงหน้าได้ไม่เกิน ' + s.daysAhead + ' วัน';
  const wd = new Date(d + 'T00:00:00Z').getUTCDay();
  if (wd === 0 || wd === 6 || s.closedDates.indexOf(d) >= 0) return 'วันที่เลือกเป็นวันหยุดราชการ';
  return '';
}

// เรียกภายใต้ lock เท่านั้น — ลำดับคิวนับต่อวัน (ต่อจากเลขมากสุดของวันนั้น) รวมจองออนไลน์และหน้างาน
function append_(source, f) {
  const code = Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
  const queue = rows_().filter(r => r.date === f.date).reduce((m, r) => Math.max(m, Number(r.queue) || 0), 0) + 1;
  const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  const rec = { id: code, created: now, source: source, status: 'รอ', staffNote: '', updated: now, queue: queue };
  Object.keys(f).forEach(k => rec[k] = f[k]);
  SpreadsheetApp.getActive().getSheetByName(SHEET_REQ).appendRow(COLS.map(c => text_(rec[c])));
  return { code: code, queue: queue };
}

function setStatus_(b) {
  if (STATUSES.indexOf(b.status) < 0) throw new Error('สถานะไม่ถูกต้อง');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_REQ);
    const ids = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().map(r => r[0]);
    const i = ids.indexOf(String(b.id));
    if (i < 0) throw new Error('ไม่พบรายการนี้');
    const row = i + 2, c = COLS.indexOf('status') + 1;
    sh.getRange(row, c, 1, 3).setValues([[b.status, text_(String(b.staffNote || '').slice(0, 500)),
      Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss')]]);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function addDays_(d, n) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// ข้อความที่ขึ้นต้นด้วย = + - @ จะกลายเป็นสูตรในชีต → ใส่ ' นำหน้า
function text_(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// ---------- ล็อกอิน ----------
function login_(user, pass) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('login_fails') || 0);
  if (fails >= MAX_FAILS) throw new Error('ใส่รหัสผิดหลายครั้ง กรุณารอ 15 นาที');
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('ADMIN_HASH')) throw new Error('ยังไม่ได้ตั้งรหัสผ่าน — รัน setPassword() ใน Apps Script ก่อน');
  const ok = String(user || '').trim() === p.getProperty('ADMIN_USER') &&
    sha256_(p.getProperty('ADMIN_SALT') + String(pass || '')) === p.getProperty('ADMIN_HASH');
  if (!ok) {
    cache.put('login_fails', String(fails + 1), 15 * 60);
    Utilities.sleep(800);
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  const token = Utilities.getUuid() + Utilities.getUuid();
  cache.put('tok_' + token, '1', SESSION_SECONDS);
  return token;
}

function validToken_(t) {
  return !!t && CacheService.getScriptCache().get('tok_' + t) === '1';
}

function sha256_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- รันเองใน Apps Script ----------

/** ตั้งชื่อผู้ใช้/รหัสผ่านเจ้าหน้าที่: ใส่ค่า → กด Run → แล้วลบรหัสออกจากโค้ดทันที */
function setPassword() {
  const USER = 'admin';
  const NEW_PASSWORD = '';
  if (!NEW_PASSWORD) throw new Error('ใส่รหัสผ่านใหม่ใน NEW_PASSWORD ก่อนรัน แล้วลบออกหลังรันเสร็จ');
  const salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  PropertiesService.getScriptProperties().setProperties({
    ADMIN_USER: USER, ADMIN_SALT: salt, ADMIN_HASH: sha256_(salt + NEW_PASSWORD)
  });
  Logger.log('ตั้งค่าแล้ว: ผู้ใช้ ' + USER + ' — อย่าลืมลบรหัสผ่านออกจากโค้ด');
}

/** สร้างชีต รายการ / ตั้งค่า (ไม่แตะชีตอื่น และไม่เขียนทับชีตที่มีอยู่แล้ว) */
function setup() {
  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(SHEET_REQ)) {
    const sh = ss.insertSheet(SHEET_REQ);
    sh.getRange('A:N').setNumberFormat('@'); // วันที่/เบอร์โทรเก็บเป็นข้อความ — ไม่ให้ชีตแปลงเป็นวันที่หรือตัด 0 หน้า
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SHEET_SET)) {
    const sh = ss.insertSheet(SHEET_SET);
    sh.getRange('A:C').setNumberFormat('@');
    sh.getRange(1, 1, 1, 3).setValues([['key', 'value', 'คำอธิบาย']]).setFontWeight('bold');
    sh.getRange(2, 1, DEFAULTS.length, 3).setValues(DEFAULTS).setVerticalAlignment('top').setWrap(true);
    sh.setColumnWidth(2, 320);
  }
  Logger.log('พร้อมใช้งาน');
}
