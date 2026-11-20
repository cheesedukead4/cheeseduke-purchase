/*
 * 採購工作看板：畫面程式
 * ---------------------------------------------------------------
 * 分頁：#orders 叫貨進度｜#daily 每日工作｜#calendar 行事曆｜#approvals 簽核｜#vendors 廠商產品查詢（產品比價／原物料分析）｜#users 人員與權限（只有管理員）
 * 資料：PBStore（js/cloud-store.js）的 orders、vendors、products、materials、tasks、people、daily、events，會同步給所有人
 * 權限：PBAuth.can(代號)，管理員全部都有。代號見 PERMS。這是畫面權限，雲端後端只擋「不在名單的人」。
 *
 * 叫貨單欄位：{ id, no, date, item, spec, qty, unit, vendorId, vendorName, price, amount, needBy, requester, note,
 *   progress: todo|ordered|partial|received|cancelled, approval: draft|l1|l2|approved|rejected,
 *   receivedQty, createdBy, createdAt, submittedAt, approvedAt, orderedAt, receivedAt, rejectNote, prevProgress,
 *   history: [{ id, act, by, role, at, note, to, add }], sample?, updatedAt }
 * 廠商：{ id, code(廠商代號), name, category, contact, phone, email, terms, leadDays, url(型錄／官網網址), note, sample? }
 * 產品：{ id, vendorId, name, spec, category, unit, price(0＝未報價), priceType: ''(採購報價)|'retail'(公開零售價／菜單價),
 *   moq, leadDays, level: ''(單一品項)|'cat'(品類)|'menu'(菜單品項), url(來源網址), note, sample? }
 * 內部原料 materials：{ id, code(料號), name, alias(其他名稱，逗號分隔), spec, category, unit, usage(每月用量), note, sample?, createdAt, updatedAt }
 * 每日工作項目 tasks：{ id, title, note, days: [0-6，空=每天], who: null(所有人) | [email], order, start, end(停用後的最後一天), createdAt, updatedAt }
 * 人員名冊 people：{ id: email, email, name, seenAt, off?(不做每日工作), createdAt, updatedAt }，登入時自動建立
 * 每日紀錄 daily：{ id: 日期|email, date, email, name, checks: { 項目id: { at, t: 項目名稱 } }, extras: [{ id, title, done, at }],
 *   note, doneAt(自己確認), due: [{ id, t, n }](確認當下的清單), confirmAt, confirmBy, confirmNote(主管確認),
 *   returnNote, returnBy(主管退回), log: [{ id, act, by, at, note }], updatedAt }
 * 行事曆 events：{ id, title, cat: meet|visit|deliver|remind|leave|other, date, end(跨天的最後一天，可空), time, endTime, note,
 *   createdBy(email), byName, createdAt, updatedAt }
 */
(function () {
'use strict';

/* ---------- 小工具 ---------- */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => ymd(new Date());
const parseYmd = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const WK = '日一二三四五六';
const md = s => s ? (+s.slice(5, 7)) + '/' + (+s.slice(8, 10)) : '—';
const wk = s => '週' + WK[parseYmd(s).getDay()];
const stamp = iso => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const isoDay = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : ymd(d); };
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const money = n => 'NT$' + Math.round(num(n)).toLocaleString('zh-TW');
const price = n => 'NT$' + num(n).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const qtyf = n => num(n).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const nowIso = () => new Date().toISOString();
const cmpZh = (a, b) => String(a || '').localeCompare(String(b || ''), 'zh-Hant');
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const PROGRESS = [
  { k: 'todo', label: '待叫貨' },
  { k: 'ordered', label: '已叫貨' },
  { k: 'partial', label: '部分到貨' },
  { k: 'received', label: '已到貨' },
];
const PROG_LABEL = { todo: '待叫貨', ordered: '已叫貨', partial: '部分到貨', received: '已到貨', cancelled: '已取消' };
const APPR = { draft: '草稿', l1: '待主管簽核', l2: '待經理核准', approved: '已核准', rejected: '退回' };
const PERMS = [
  { id: 'order', label: '叫貨', desc: '新增、修改叫貨單，送出簽核，標記已叫貨、登記到貨' },
  { id: 'approve1', label: '主管簽核', desc: '第一關：核准或退回送簽的叫貨單' },
  { id: 'approve2', label: '經理核准', desc: '第二關：核准後才能叫貨' },
  { id: 'vendor', label: '廠商產品維護', desc: '新增、修改廠商與產品報價，從 Excel 匯入' },
  { id: 'task', label: '每日工作管理', desc: '設定每日工作項目、查看全員打勾進度，做主管確認或退回（每個人自己的打勾不需要權限）' },
];
const PERM_LABEL = Object.fromEntries(PERMS.map(p => [p.id, p.label]));

/* ---------- 資料與權限 ---------- */
const D = {
  orders: () => PBStore.list('orders'),
  vendors: () => PBStore.list('vendors'),
  products: () => PBStore.list('products'),
  materials: () => PBStore.list('materials'),
  tasks: () => PBStore.list('tasks'),
  people: () => PBStore.list('people'),
  daily: () => PBStore.list('daily'),
  events: () => PBStore.list('events'),
};
let vById = new Map();
const S = { view: 'orders', day: today(), dday: today(), dmode: 'me', dperson: null, dpday: null, cmonth: today().slice(0, 7), cday: today(), corders: true, vmode: 'products', mq: '', mflag: '', pall: false, scope: 'day', q: '', flag: null, pq: '', pcat: '', pvendor: '', detailId: null, busy: false };
const can = p => !!(window.PBAuth && PBAuth.can(p));
const isAdmin = () => !!(window.PBAuth && PBAuth.isAdmin());
const myName = () => (window.PBAuth && (PBAuth.name() || PBAuth.email())) || '';
const canApprove = o => (o.approval === 'l1' && can('approve1')) || (o.approval === 'l2' && can('approve2'));

function upd(kind, id, patch, msg) {
  const cur = PBStore.get(kind, id);
  if (!cur) { toast('找不到這筆資料，可能已被別人刪除。'); return false; }
  PBStore.save(kind, { ...cur, ...patch });
  if (msg) toast(msg);
  return true;
}
function histAdd(o, entry) { return [...(o.history || []), { id: rid(), by: myName(), at: nowIso(), ...entry }]; }

/* ---------- 畫面更新 ---------- */
// 用 setTimeout 合併多次更新（不用 requestAnimationFrame：App 在背景時它會暫停，切回來前畫面不會更新）
let rq = 0;
function scheduleRender() { if (rq) return; rq = setTimeout(() => { rq = 0; render(); }, 16); }
function onData() { vById = new Map(D.vendors().map(v => [v.id, v])); dIdx = null; scheduleRender(); }
function render() {
  renderChrome();
  if (S.view === 'orders') renderOrders();
  else if (S.view === 'daily') renderDaily();
  else if (S.view === 'calendar') renderCalendar();
  else if (S.view === 'approvals') renderApprovals();
  else if (S.view === 'vendors') renderVendors();
  else renderUsers();
  if (dlg.open && S.detailId) {
    const a = document.activeElement;
    const typing = a && dlg.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
    if (!typing) dlg.innerHTML = detailHtml(S.detailId);
  }
  if (dlg.open && S.dperson) {
    const a = document.activeElement;
    const typing = a && dlg.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
    if (!typing) dlg.innerHTML = personDayHtml(S.dpday, S.dperson);
  }
}
function route() {
  const h = location.hash.slice(1);
  let v = ['orders', 'daily', 'calendar', 'approvals', 'vendors', 'users'].includes(h) ? h : 'orders';
  if (v === 'users' && !isAdmin()) v = 'orders';
  S.view = v;
  $$('main > .view').forEach(s => { s.hidden = s.id !== 'view-' + S.view; });
  $$('.tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.view === S.view ? 'page' : 'false'));
  if (v === 'users') loadUsers();
  render();
}
function renderChrome() {
  $('#meName').textContent = myName();
  $('#newOrderBtn').hidden = !can('order');
  $('#usersTab').hidden = !isAdmin();
  $('#vendorTools').hidden = !can('vendor');
  renderSync(); renderBanner(); renderBadge();
}
function renderSync() {
  const st = PBStore.status(), el = $('#sync');
  const map = {
    loading: ['busy', '讀取中…'], syncing: ['busy', '同步中…'], pending: ['busy', '等待上傳'],
    synced: ['ok', '已同步'], offline: ['warn', '離線'], error: ['bad', '連線失敗'],
  };
  const [cls, txt] = map[st.state] || ['', st.state];
  const html = `<i aria-hidden="true"></i>${esc(txt)}`;
  if (el.innerHTML !== html) el.innerHTML = html;
  el.className = 'sync ' + cls;
  el.title = (st.detail ? st.detail + '。' : '') + (st.lastSync ? '上次同步 ' + stamp(new Date(st.lastSync).toISOString()) + '。' : '') + '按一下立即同步';
}
let lastBanner = '';
function renderBanner() {
  const st = PBStore.status(), b = [];
  if (st.state === 'error') b.push(`<div class="banner bad">${esc(st.detail || '無法連線到雲端')}<button class="btn sm" type="button" data-sync>重試</button></div>`);
  else if (st.state === 'offline') b.push(`<div class="banner warn">${esc(st.detail || '目前離線')}。修改會先存在這台裝置，恢復網路後自動上傳。</div>`);
  const n = sampleCount();
  if (n && isAdmin()) b.push(`<div class="banner">目前有 ${n} 筆範例資料（標有「範例」）。開始正式使用前請清除。<button class="btn sm" type="button" data-act="clear-sample" data-confirm="確定清除全部範例？">清除範例資料</button></div>`);
  if (window.PBAuth && PBAuth.user() && !isAdmin() && !PERMS.some(p => can(p.id))) b.push(`<div class="banner">你目前只能查看叫貨資料（每日工作可以正常打勾）。需要新增叫貨或簽核的話，請找管理員開權限。</div>`);
  const html = b.join('');
  if (html !== lastBanner) { $('#banner').innerHTML = html; lastBanner = html; }
}
function renderBadge() {
  const n = D.orders().filter(o => o.progress !== 'cancelled' && canApprove(o)).length;
  const el = $('#apprBadge'); el.hidden = !n; el.textContent = n;
  // 每日工作：今天還沒打勾的項目數（確認後不顯示）
  const info = myEmail() ? dayItems(today(), myEmail()) : { total: 0, done: 0 };
  const left = info.rec && (info.rec.doneAt || info.rec.confirmAt) ? 0 : info.total - info.done;
  const db = $('#dailyBadge'); db.hidden = !left; db.textContent = left;
}
const sampleCount = () => ['orders', 'vendors', 'products', 'materials'].reduce((a, k) => a + D[k]().filter(x => x.sample).length, 0);
const loaded = () => PBStore.status().loaded;
function keepInputs(root, fn) {
  const vals = {}; $$('input,textarea', root).forEach(i => { if (i.id) vals[i.id] = i.value; });
  const a = document.activeElement; const aid = a && root.contains(a) ? a.id : null;
  let sel = null; try { if (aid && a.selectionStart != null) sel = [a.selectionStart, a.selectionEnd]; } catch (e) {}
  fn();
  for (const [id, v] of Object.entries(vals)) { const el = document.getElementById(id); if (el && root.contains(el)) el.value = v; }
  if (aid) { const el = document.getElementById(aid); if (el) { el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
}

/* ---------- 共用片段 ---------- */
const vendorName = o => { const v = vById.get(o.vendorId); return v ? v.name : (o.vendorName || '未指定廠商'); };
const vName = id => { const v = vById.get(id); return v ? v.name : '（已刪除的廠商）'; };
const isOverdue = o => !!o.needBy && o.needBy < today() && !['received', 'cancelled'].includes(o.progress);
const seal = (t, d, cls) => `<span class="seal ${cls || ''}" role="img" aria-label="${esc(t)}${d ? ' ' + esc(md(d)) : ''}"><b>${esc(t)}</b>${d ? `<i>${esc(md(d))}</i>` : ''}</span>`;
const chip = o => `<span class="chip ${esc(o.approval)}">${esc(APPR[o.approval] || o.approval || '')}</span>`;
const sampleTag = x => x.sample ? '<span class="tag-sample">範例</span>' : '';
const loadingBox = what => `<div class="empty"><h3>正在讀取${what}…</h3><p>第一次開啟要從雲端下載資料，可能需要幾秒鐘。</p></div>`;

/* ---------- 叫貨進度 ---------- */
function ordersInScope() {
  let list = D.orders().filter(o => o.progress !== 'cancelled');
  if (S.flag) {
    list = list.filter(o => o.progress !== 'received');
    if (S.flag === 'overdue') list = list.filter(isOverdue);
    if (S.flag === 'toorder') list = list.filter(o => o.progress === 'todo' && o.approval === 'approved');
    if (S.flag === 'transit') list = list.filter(o => o.progress === 'ordered' || o.progress === 'partial');
  } else if (S.scope === 'day') list = list.filter(o => o.date === S.day);
  else if (S.scope === 'open') list = list.filter(o => o.progress !== 'received');
  if (S.q) {
    const q = S.q.toLowerCase();
    list = list.filter(o => [o.no, o.item, o.spec, vendorName(o), o.requester, o.note].some(x => String(x || '').toLowerCase().includes(q)));
  }
  return list;
}
function renderOrders() {
  $('#day').value = S.day;
  $('#dayinfo').textContent = (S.day === today() ? '今天 · ' : '') + wk(S.day);
  $('#todayBtn').hidden = S.day === today();
  $$('[data-scope]').forEach(b => b.setAttribute('aria-pressed', String(!S.flag && b.dataset.scope === S.scope)));
  renderKpis();
  const orders = D.orders();
  const hint = $('#hintbar'), board = $('#board'), note = $('#boardNote');
  if (!orders.length) {
    hint.innerHTML = ''; note.textContent = '';
    board.style.display = 'block';
    board.innerHTML = !loaded() ? loadingBox('叫貨資料') : `<div class="empty">
        <h3>還沒有任何叫貨單</h3>
        <p>按「新增叫貨」建立第一張叫貨單。送出後會進入簽核：主管簽核 → 經理核准，核准後就能標記已叫貨、登記到貨，每天的進度都會排在這個看板上。</p>
        <div class="row">${can('order') ? '<button class="btn primary" type="button" data-new-order>＋ 新增叫貨</button>' : ''}${isAdmin() ? '<button class="btn" type="button" data-sample>載入範例資料</button>' : ''}</div>
        ${isAdmin() ? '<p class="small">範例資料都會標上「範例」，之後可以一鍵清除。</p>' : ''}
      </div>`;
    return;
  }
  board.style.display = '';
  const flagLabel = { overdue: '逾期未到貨', toorder: '已核准待叫貨', transit: '在途' }[S.flag];
  if (S.flag) hint.innerHTML = `篩選中 <span class="fchip">${flagLabel}<button type="button" data-clear-flag aria-label="清除篩選">×</button></span>`;
  else if (S.scope === 'day' && !orders.some(o => o.date === S.day && o.progress !== 'cancelled')) {
    hint.innerHTML = `${md(S.day)} 還沒有叫貨單。${can('order') ? '<button class="btn sm" type="button" data-new-order>＋ 新增叫貨</button>' : ''}<button class="btn sm" type="button" data-scope="open">看所有未結案</button>`;
  } else hint.innerHTML = '';

  const list = ordersInScope();
  const by = { todo: [], ordered: [], partial: [], received: [] };
  for (const o of list) (by[o.progress] || by.todo).push(o);
  const sortFn = (a, b) => (isOverdue(b) - isOverdue(a)) || cmpZh(a.needBy || '9999', b.needBy || '9999') || cmpZh(a.no, b.no);
  board.innerHTML = PROGRESS.map(p => {
    const arr = by[p.k].sort(sortFn);
    return `<section class="col col-${p.k}" aria-label="${p.label}">
      <header><span class="dot" aria-hidden="true"></span><h3>${p.label}</h3><span class="n">${arr.length}</span></header>
      <div class="cards">${arr.map(card).join('') || '<p class="col-empty">沒有單據</p>'}</div>
    </section>`;
  }).join('');
  const cancelled = orders.filter(o => o.progress === 'cancelled' && (S.scope !== 'day' || o.date === S.day)).length;
  note.textContent = cancelled ? `另有 ${cancelled} 筆已取消，不顯示在看板上（可用搜尋找到後點開恢復）。` : '';
}
function renderKpis() {
  const live = D.orders().filter(o => o.progress !== 'cancelled');
  const day = live.filter(o => o.date === S.day);
  const dayAmt = day.reduce((a, o) => a + num(o.amount), 0);
  const pend = live.filter(o => o.approval === 'l1' || o.approval === 'l2');
  const l1 = pend.filter(o => o.approval === 'l1').length;
  const toOrder = live.filter(o => o.progress === 'todo' && o.approval === 'approved').length;
  const transit = live.filter(o => o.progress === 'ordered' || o.progress === 'partial').length;
  const over = live.filter(isOverdue).length;
  const tiles = [
    { k: 'day', label: (S.day === today() ? '今日' : md(S.day) + ' ') + '叫貨', val: day.length, sub: money(dayAmt), on: !S.flag && S.scope === 'day' },
    { k: 'appr', label: '待簽核', val: pend.length, sub: `主管 ${l1} · 經理 ${pend.length - l1}`, tone: pend.length ? 'warn' : '' },
    { k: 'toorder', label: '已核准待叫貨', val: toOrder, sub: toOrder ? '可以向廠商下單' : '沒有待下單', tone: toOrder ? 'accent' : '', on: S.flag === 'toorder' },
    { k: 'transit', label: '在途', val: transit, sub: '已叫貨、未全數到貨', on: S.flag === 'transit' },
    { k: 'overdue', label: '逾期未到貨', val: over, sub: '超過需求日期', tone: over ? 'bad' : '', on: S.flag === 'overdue' },
  ];
  $('#kpis').innerHTML = tiles.map(t => `<button type="button" class="kpi ${t.tone || ''}${t.on ? ' on' : ''}" data-kpi="${t.k}">
    <span class="k-label">${esc(t.label)}</span><span class="k-val">${t.val}<small>筆</small></span><span class="k-sub">${esc(t.sub)}</span></button>`).join('');
}
function dueText(o) {
  if (o.progress === 'received') return `已到貨 ${md(isoDay(o.receivedAt))}`;
  const parts = [];
  if (o.progress === 'partial') parts.push(`到貨 ${qtyf(o.receivedQty)}/${qtyf(o.qty)}`);
  if (o.needBy) parts.push(isOverdue(o) ? `逾期 ${daysBetween(o.needBy, today())} 天 · 需求 ${md(o.needBy)}` : `需求 ${md(o.needBy)}`);
  else parts.push('未填需求日');
  return parts.join(' · ');
}
function advanceOf(o) {
  if (!can('order')) return null;
  if (o.progress === 'todo' && o.approval === 'approved') return { label: '標記已叫貨', act: 'ordered' };
  if (o.progress === 'ordered' || o.progress === 'partial') return { label: '全部到貨', act: 'receive-all' };
  return null;
}
function card(o) {
  const over = isOverdue(o), adv = advanceOf(o), sealed = o.approval === 'approved', id = esc(o.id);
  return `<article class="card${over ? ' is-over' : ''}${sealed ? ' sealed' : ''}" data-open="${id}">
    <div class="card-top"><span class="po">${esc(o.no || '')}</span>${sampleTag(o)}${sealed ? '' : chip(o)}</div>
    <button type="button" class="card-title" data-open="${id}">${esc(o.item)}${o.spec ? ` <span class="spec">${esc(o.spec)}</span>` : ''}</button>
    <div class="card-meta"><span class="qty">${qtyf(o.qty)} ${esc(o.unit || '')}</span><span>${esc(vendorName(o))}</span>${S.scope !== 'day' || S.flag ? `<span>${md(o.date)} 叫貨</span>` : ''}</div>
    <div class="card-foot"><span class="due${over ? ' over' : ''}">${esc(dueText(o))}</span>${adv ? `<button type="button" class="adv" data-act="${adv.act}" data-id="${id}">${adv.label}</button>` : ''}</div>
    ${sealed ? `<span class="card-seal">${seal('核准', isoDay(o.approvedAt), 'sm')}</span>` : ''}
  </article>`;
}
function exportCsv() {
  const list = ordersInScope().slice().sort((a, b) => cmpZh(a.no, b.no));
  if (!list.length) return toast('目前看板上沒有單據可以匯出。');
  const cell = c => {
    let s = String(c ?? '');
    if (/^[=+@]/.test(s) || /^-[^\d]/.test(s)) s = "'" + s; // 避免 Excel 把內容當公式
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = ['單號', '叫貨日期', '品名', '規格', '數量', '單位', '廠商', '單價', '金額', '需求日期', '申請人', '簽核', '進度', '已到貨', '備註'];
  const rows = list.map(o => [o.no, o.date, o.item, o.spec, o.qty, o.unit, vendorName(o), o.price, o.amount, o.needBy, o.requester, APPR[o.approval] || o.approval, PROG_LABEL[o.progress] || o.progress, o.receivedQty || 0, o.note]);
  const csv = '﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
  const name = S.flag ? { overdue: '逾期未到貨', toorder: '待叫貨', transit: '在途' }[S.flag] : S.scope === 'day' ? S.day : S.scope === 'open' ? '未結案' : '全部';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `叫貨單_${name}.csv`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast(`已匯出 ${list.length} 筆。`);
}

/* ---------- 簽核 ---------- */
function renderApprovals() {
  const live = D.orders().filter(o => o.progress !== 'cancelled');
  const bySub = (a, b) => cmpZh(a.submittedAt || a.createdAt, b.submittedAt || b.createdAt);
  const g = k => live.filter(o => o.approval === k).sort(bySub);
  const l1 = g('l1'), l2 = g('l2'), rej = g('rejected'), draft = g('draft');
  const toOrder = live.filter(o => o.approval === 'approved' && o.progress === 'todo').length;
  const weekAgo = addDays(today(), -7);
  const recent = live.filter(o => o.approval === 'approved' && isoDay(o.approvedAt) >= weekAgo).sort((a, b) => cmpZh(b.approvedAt, a.approvedAt)).slice(0, 20);
  $('#apprFlow').innerHTML = [
    { n: '1', l: '申請人送簽', v: draft.length, s: '草稿未送出' },
    { n: '2', l: '主管簽核', v: l1.length, s: '待處理', hot: l1.length },
    { n: '3', l: '經理核准', v: l2.length, s: '待處理', hot: l2.length },
    { n: '4', l: '採購叫貨', v: toOrder, s: '已核准待下單', go: toOrder },
  ].map(s => `<div class="st${s.hot ? ' hot' : ''}${s.go ? ' go' : ''}"><span class="st-n">步驟 ${s.n}</span><span class="st-l">${s.l}</span><span class="st-v">${s.v}</span><span class="k-sub">${s.s}</span></div>`).join('');
  const root = $('#apprList');
  if (!D.orders().length) {
    root.innerHTML = !loaded() ? loadingBox('簽核資料') : `<div class="empty"><h3>還沒有需要簽核的單據</h3><p>新增叫貨單並按「送出簽核」後，會先出現在「待主管簽核」，主管核准後轉給經理，經理核准就能叫貨。</p>${can('order') ? '<div class="row"><button class="btn primary" type="button" data-new-order>＋ 新增叫貨</button></div>' : ''}</div>`;
    return;
  }
  const sec = (title, arr, kind, emptyText) => (arr.length || emptyText) ? `<section class="asec"><h3>${title} <span class="n">${arr.length}</span></h3>
    <div class="arows">${arr.map(o => arow(o, kind)).join('') || `<p class="empty-row">${emptyText}</p>`}</div></section>` : '';
  keepInputs(root, () => {
    root.innerHTML =
      sec('待主管簽核', l1, 'l1', '目前沒有待主管簽核的單據。') +
      sec('待經理核准', l2, 'l2', '目前沒有待經理核准的單據。') +
      sec('退回待修改', rej, 'rejected', '') +
      sec('草稿（尚未送簽）', draft, 'draft', '') +
      sec('近 7 天已核准', recent, 'approved', '');
  });
}
function arow(o, kind) {
  const id = esc(o.id);
  const waitDays = o.submittedAt ? daysBetween(isoDay(o.submittedAt), today()) : 0;
  let act = '';
  if (kind === 'l1' || kind === 'l2') {
    act = canApprove(o)
      ? `<input id="note-${id}" placeholder="簽核意見（退回必填）" aria-label="簽核意見"><button class="btn primary sm" type="button" data-act="approve" data-id="${id}" data-note="note-${id}">${kind === 'l1' ? '主管核准' : '經理核准'}</button><button class="btn sm danger" type="button" data-act="reject" data-id="${id}" data-note="note-${id}">退回</button>`
      : `<span class="hint">等待${kind === 'l1' ? '主管' : '經理'}簽核</span>`;
  } else if (kind === 'rejected' && can('order')) act = `<button class="btn sm" type="button" data-act="edit" data-id="${id}">修改</button><button class="btn sm primary" type="button" data-act="resubmit" data-id="${id}">重新送簽</button>`;
  else if (kind === 'draft' && can('order')) act = `<button class="btn sm primary" type="button" data-act="submit" data-id="${id}">送出簽核</button>`;
  else if (kind === 'approved') act = seal('核准', isoDay(o.approvedAt), 'sm');
  const waiting = (kind === 'l1' || kind === 'l2') && o.submittedAt
    ? `<span class="${waitDays >= 1 ? 'wait' : ''}">送簽 ${esc(stamp(o.submittedAt))}${waitDays >= 1 ? ` · 已等 ${waitDays} 天` : ''}</span>` : '';
  return `<div class="arow">
    <div class="arow-main">
      <div class="meta-line"><span class="po">${esc(o.no)}</span>${sampleTag(o)}${o.requester ? `<span>${esc(o.requester)}</span>` : ''}${waiting}</div>
      <button type="button" class="card-title" data-open="${id}">${esc(o.item)}${o.spec ? ` <span class="spec">${esc(o.spec)}</span>` : ''}</button>
      <div class="card-meta"><span class="qty">${qtyf(o.qty)} ${esc(o.unit || '')}</span><span>${esc(vendorName(o))}</span><span class="amt">${money(o.amount)}</span>${o.needBy ? `<span>需求 ${md(o.needBy)}</span>` : ''}</div>
      ${kind === 'rejected' ? `<div class="reason">退回原因：${esc(o.rejectNote || '未填寫')}</div>` : ''}
    </div>
    ${act ? `<div class="arow-act">${act}</div>` : ''}
  </div>`;
}

/* ---------- 廠商產品查詢 ---------- */
// 報價種類：有單價的採購報價優先，其次是官網公開零售價／菜單價，最後是還沒報價的
const isQuote = p => num(p.price) > 0 && p.priceType !== 'retail';
const offerRank = p => isQuote(p) ? 0 : num(p.price) > 0 ? 1 : 2;
const offerSort = (a, b) => (offerRank(a) - offerRank(b)) || (num(a.price) - num(b.price));
const okUrl = u => /^https?:\/\/\S+$/i.test(String(u || '').trim());
const extLink = (u, label) => okUrl(u) ? `<a href="${esc(String(u).trim())}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
const noPriceText = p => p.priceType === 'retail' ? '未標價' : '未報價';
function priceCell(p) {
  if (!(num(p.price) > 0)) return `<span class="muted">${noPriceText(p)}</span>`;
  return `${price(p.price)}${p.unit ? `<small>／${esc(p.unit)}</small>` : ''}${p.priceType === 'retail' ? '<span class="tag-retail" title="官網公開零售價或菜單價，不是採購報價">零售價</span>' : ''}`;
}
const priceText = p => num(p.price) > 0 ? `${price(p.price)}${p.unit ? '／' + p.unit : ''}${p.priceType === 'retail' ? '（零售價）' : ''}` : noPriceText(p);
const levelTag = p => p.level === 'cat' ? '<span class="tag-lv" title="廠商可供應的品類，不是單一品項">品類</span>' : p.level === 'menu' ? '<span class="tag-lv">菜單</span>' : '';
const vendorSort = (a, b) => ((!a.code) - (!b.code)) || cmpZh(a.code || '', b.code || '') || cmpZh(a.name, b.name);
const vLabel = v => (v.code ? v.code + ' ' : '') + v.name;
const PGROUP_LIMIT = 60; // 沒有搜尋或篩選時，先顯示前 60 種產品，避免一次畫太多

function renderVendors() {
  $$('[data-vmode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vmode === S.vmode)));
  $('#prodPane').hidden = S.vmode === 'materials';
  $('#matPane').hidden = S.vmode !== 'materials';
  if (S.vmode === 'materials') return renderMaterials();
  const vendors = D.vendors(), products = D.products();
  const vs = [...vendors].sort(vendorSort);
  const sel = $('#pvendor');
  if (S.pvendor && !vById.has(S.pvendor)) S.pvendor = '';
  const opts = `<option value="">全部廠商</option>` + vs.map(v => `<option value="${esc(v.id)}">${esc(vLabel(v))}</option>`).join('');
  if (sel.dataset.h !== opts) { sel.innerHTML = opts; sel.dataset.h = opts; }
  sel.value = S.pvendor;
  S.pcat = ''; // 分類按鈕列已拿掉（分類太多太雜），用搜尋代替
  const counts = {}; for (const p of products) counts[p.vendorId] = (counts[p.vendorId] || 0) + 1;
  const q = S.pq.toLowerCase();
  const vshow = q ? vs.filter(v => [v.code, v.name, v.category, v.contact, v.note].some(x => String(x || '').toLowerCase().includes(q))) : vs;
  $('#vcount').textContent = vs.length ? (q ? `${vshow.length} / ${vs.length} 家` : vs.length + ' 家') : '';
  $('#vlist').innerHTML = vshow.length ? vshow.map(v => `<button type="button" class="vitem${S.pvendor === v.id ? ' on' : ''}" data-vendor="${esc(v.id)}">
      <span class="vname">${v.code ? `<span class="vcode">${esc(v.code)}</span>` : ''}${esc(v.name)} ${sampleTag(v)}</span><span class="vcount">${counts[v.id] || 0} 項</span>
      <span class="vmeta">${esc([v.category, v.contact].filter(Boolean).join(' · ') || '—')}</span></button>`).join('')
    : `<p class="col-empty">${vs.length ? '沒有符合的廠商。' : '還沒有廠商。'}</p>`;
  const out = $('#presults');
  if (!products.length && !vendors.length) {
    out.innerHTML = !loaded() ? loadingBox('廠商資料') : `<div class="empty"><h3>還沒有廠商產品資料</h3>
      <p>先建立廠商，再登錄每家可以提供的產品、單價、最小訂量和交期。已經有 Excel 價目表的話，直接複製表格貼上就能一次匯入。</p>
      <div class="row">${can('vendor') ? '<button class="btn primary" type="button" data-import>從 Excel 貼上匯入</button><button class="btn" type="button" data-add-vendor>新增廠商</button>' : ''}${isAdmin() ? '<button class="btn" type="button" data-sample>載入範例資料</button>' : ''}</div></div>`;
    return;
  }
  let head = '';
  if (S.pvendor) {
    const v = vById.get(S.pvendor);
    const f = (k, val) => val ? `<div><dt>${k}</dt><dd>${esc(val)}</dd></div>` : '';
    head = `<div class="vhead"><div class="vhead-top"><h3>${v.code ? `<span class="vcode">${esc(v.code)}</span>` : ''}${esc(v.name)}</h3>${sampleTag(v)}
      ${can('vendor') ? `<button class="btn sm" type="button" data-edit-vendor="${esc(v.id)}">編輯廠商</button>` : ''}<button class="btn sm ghost" type="button" data-vendor="">看全部廠商</button></div>
      <dl>${f('主要品類', v.category)}${f('聯絡人', v.contact)}${f('電話', v.phone)}${f('Email', v.email)}${f('付款條件', v.terms)}${v.leadDays ? f('平均交期', v.leadDays + ' 天') : ''}${okUrl(v.url) ? `<div><dt>型錄／官網</dt><dd>${extLink(v.url, '開啟連結')}</dd></div>` : ''}${f('備註', v.note)}</dl></div>`;
  }
  let list = products;
  if (S.pvendor) list = list.filter(p => p.vendorId === S.pvendor);
  if (S.pcat) list = list.filter(p => p.category === S.pcat);
  if (q) list = list.filter(p => [p.name, p.spec, p.category, vName(p.vendorId), (vById.get(p.vendorId) || {}).code].some(x => String(x || '').toLowerCase().includes(q)));
  const groups = new Map();
  for (const p of list) { const k = (p.name || '').trim(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const keys = [...groups.keys()].sort(cmpZh);
  let body;
  if (!keys.length) {
    body = S.pq ? `<div class="empty"><h3>找不到「${esc(S.pq)}」</h3><p>試試比較短的關鍵字，例如只打「螺絲」或「紙箱」，或改成全部廠商。${vshow.length ? `廠商名錄裡有 ${vshow.length} 家符合，點廠商名稱可以看它的型錄連結。` : ''}</p></div>`
      : `<div class="empty"><h3>這個條件下還沒有產品</h3><p>${S.pvendor ? '這家廠商還沒登錄產品。' : ''}${can('vendor') ? '可以按「新增產品」加入。' : ''}</p>${can('vendor') ? '<div class="row"><button class="btn" type="button" data-add-product>新增產品</button></div>' : ''}</div>`;
  } else {
    const showActs = can('order') || can('vendor');
    const limited = !q && !S.pvendor && !S.pcat && !S.pall && keys.length > PGROUP_LIMIT;
    const shown = limited ? keys.slice(0, PGROUP_LIMIT) : keys;
    body = `<p class="pcount">${keys.length} 種產品 · ${list.length} 筆${S.pq ? `（搜尋「${esc(S.pq)}」）` : ''}</p>` + shown.map(k => {
      const arr = groups.get(k).sort(offerSort);
      const vcount = new Set(arr.map(p => p.vendorId)).size;
      const quotes = arr.filter(isQuote);
      const sum = quotes.length > 1 ? ` · 最低 ${price(quotes[0].price)}／${esc(quotes[0].unit || '')}（${esc(vName(quotes[0].vendorId))}）`
        : !quotes.length && arr.some(p => num(p.price) > 0) ? ' · 只有公開零售價' : !quotes.length ? ' · 尚無報價' : '';
      return `<div class="pgroup"><div class="pg-head"><h4>${esc(k)}</h4><span class="pg-sum">${vcount} 家供應${sum}</span></div>
        <div class="tscroll"><table class="pt"><thead><tr><th>廠商</th><th>規格</th><th class="r">單價</th><th class="r">最小訂量</th><th class="r">交期</th>${showActs ? '<th class="r"><span class="muted">操作</span></th>' : ''}</tr></thead><tbody>
        ${arr.map((p, i) => `<tr>
          <td><button type="button" class="link" data-vendor="${esc(p.vendorId)}">${esc(vName(p.vendorId))}</button> ${sampleTag(p)}</td>
          <td${p.note ? ` title="${esc(p.note)}"` : ''}>${levelTag(p)}${[p.spec ? esc(p.spec) : '', p.category ? `<span class="muted">${esc(p.category)}</span>` : '', okUrl(p.url) ? `<span class="muted">${extLink(p.url, '來源')}</span>` : ''].filter(Boolean).join(' <span class="muted">·</span> ') || (p.level ? '' : '—')}</td>
          <td class="r num">${priceCell(p)}${i === 0 && isQuote(p) && quotes.length > 1 && num(p.price) < num(quotes[quotes.length - 1].price) ? '<span class="best">最低</span>' : ''}</td>
          <td class="r num">${p.moq ? qtyf(p.moq) + ' <small>' + esc(p.unit || '') + '</small>' : '—'}</td>
          <td class="r num">${p.leadDays ? qtyf(p.leadDays) + ' <small>天</small>' : '—'}</td>
          ${showActs ? `<td class="r"><span class="acts">${can('order') ? `<button class="btn sm" type="button" data-order-product="${esc(p.id)}">叫貨</button>` : ''}${can('vendor') ? `<button class="icon-btn sm" type="button" data-edit-product="${esc(p.id)}" aria-label="編輯 ${esc(p.name)}">✎</button>` : ''}</span></td>` : ''}
        </tr>`).join('')}</tbody></table></div></div>`;
    }).join('') + (limited ? `<div class="row"><button class="btn" type="button" data-pall>還有 ${keys.length - PGROUP_LIMIT} 種產品，全部顯示</button><span class="hint">也可以用上面的搜尋或廠商縮小範圍。</span></div>` : '');
  }
  out.innerHTML = head + body;
}

/* ---------- 每日工作 ---------- */
// 每個人每天的清單 = 符合「星期、指派對象、有效期間」的工作項目 + 自己加的臨時工作。
// 打勾存在 daily 紀錄（一人一天一筆）；自己按「確認完成」後鎖定，主管再做「主管確認」或退回。
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const STATE_LABEL = { mgr: '主管已確認', self: '待主管確認', ready: '已全部打勾', doing: '進行中', todo: '未開始', none: '沒有工作' };
const STATE_ORDER = { self: 0, ready: 1, doing: 2, todo: 3, mgr: 4, none: 5 };
const PRESET_TASKS = [
  ['確認今日請購需求', '查看各單位的請購單、訊息或 Email，整理成叫貨單'],
  ['處理待簽核單據', '有簽核權限的人到「簽核」頁處理；申請人追蹤被退回的單'],
  ['向廠商下單', '已核准的叫貨單向廠商下單，完成後按「標記已叫貨」'],
  ['追蹤在途與逾期到貨', '逾期未到的打電話給廠商確認交期'],
  ['到貨點收與登記', '核對數量和品質，在 App 登記到貨'],
  ['更新廠商報價', '有新報價或價格異動時，更新到「廠商產品查詢」'],
  ['整理明日叫貨清單', '下班前確認明天要叫的貨'],
];
const myEmail = () => String((window.PBAuth && PBAuth.email()) || '').toLowerCase();
const canTask = () => can('task');
const hm = iso => { const d = new Date(iso); return isNaN(d) ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dailyId = (date, email) => date + '|' + email;
let dIdx = null; // daily 紀錄索引（id -> 紀錄），資料變動時清掉
function dayRec(date, email) {
  if (!dIdx) dIdx = new Map(D.daily().map(r => [r.id, r]));
  return dIdx.get(dailyId(date, email)) || null;
}
function personName(email, rec) {
  const p = PBStore.get('people', email);
  return (p && p.name) || (rec && rec.name) || email;
}
function daysText(days) {
  const d = Array.isArray(days) ? days : [];
  if (!d.length || d.length === 7) return '每天';
  const s = WEEK_ORDER.filter(x => d.includes(x)).join(',');
  if (s === '1,2,3,4,5') return '週一至週五';
  if (s === '1,2,3,4,5,6') return '週一至週六';
  return '週' + WEEK_ORDER.filter(x => d.includes(x)).map(x => WK[x]).join('、');
}
function whoText(t) {
  if (!Array.isArray(t.who)) return '所有人';
  if (!t.who.length) return '（沒有指派）';
  const n = t.who.map(e => personName(e));
  return n.length > 3 ? n.slice(0, 3).join('、') + ` 等 ${n.length} 人` : n.join('、');
}
const taskSort = (a, b) => (num(a.order) - num(b.order)) || cmpZh(a.title, b.title);
function taskOn(t, date, email) {
  if (t.start && date < t.start) return false;
  if (t.end && date > t.end) return false;
  const days = Array.isArray(t.days) ? t.days : [];
  if (days.length && !days.includes(parseYmd(date).getDay())) return false;
  if (Array.isArray(t.who)) return t.who.includes(email);
  const p = PBStore.get('people', email);
  return !(p && p.off); // 「所有人」不含設定為不做每日工作的人
}
// 確認過的日子用當時存下的清單（之後改項目也不影響紀錄），還沒確認的用目前的設定
function dueFor(date, email, rec) {
  if (rec && Array.isArray(rec.due)) return rec.due;
  return D.tasks().filter(t => taskOn(t, date, email)).sort(taskSort).map(t => ({ id: t.id, t: t.title, n: t.note || '' }));
}
function dayItems(date, email) {
  const rec = dayRec(date, email), due = dueFor(date, email, rec), checks = (rec && rec.checks) || {};
  const items = due.map(x => ({ id: x.id, title: x.t, note: x.n, done: !!checks[x.id], at: checks[x.id] && checks[x.id].at, kind: 't' }));
  // 打過勾、但已不在清單上的項目（例如後來被刪除）照樣列出，紀錄不會不見
  for (const [id, c] of Object.entries(checks)) if (!due.some(x => x.id === id)) items.push({ id, title: (c && c.t) || '（已刪除的項目）', done: true, at: c && c.at, kind: 't' });
  for (const x of (rec && rec.extras) || []) items.push({ id: x.id, title: x.title, note: '', done: !!x.done, at: x.at, kind: 'x' });
  return { rec, items, total: items.length, done: items.filter(i => i.done).length };
}
function dayState(info) {
  const r = info.rec;
  if (r && r.confirmAt) return 'mgr';
  if (r && r.doneAt) return 'self';
  if (!info.total) return 'none';
  if (!info.done) return 'todo';
  return info.done >= info.total ? 'ready' : 'doing';
}
const pctOf = info => info.total ? Math.round(info.done / info.total * 100) : 0;
const bar = info => `<span class="bar" aria-hidden="true"><i style="width:${pctOf(info)}%"></i></span>`;
const doneAtText = (at, date) => !at ? '' : isoDay(at) === date ? hm(at) : stamp(at);

// 修改某人某天的紀錄；fn 回傳 false 代表不儲存
function dayNext(date, email, fn) {
  const cur = dayRec(date, email) || { id: dailyId(date, email), date, email, name: email === myEmail() ? myName() : personName(email), checks: {}, extras: [], note: '', log: [] };
  const next = JSON.parse(JSON.stringify(cur));
  if (fn(next) === false) return null;
  next.updatedAt = nowIso();
  return next;
}
function saveDay(date, email, fn, msg) {
  const next = dayNext(date, email, fn);
  if (!next) return false;
  PBStore.save('daily', next);
  if (msg) toast(msg);
  return true;
}
const logAdd = (r, act, note) => { r.log = [...(r.log || []), { id: rid(), act, by: myName(), at: nowIso(), ...(note ? { note } : {}) }]; };
const lockedMsg = r => { if (r.confirmAt) { toast('主管已確認，不能再修改。'); return true; } if (r.doneAt) { toast('已確認完成的工作不能修改，請先按「取消確認」。'); return true; } return false; };

// 登入的人自動加入人員名冊（每日工作的指派、團隊確認名單用）
function ensureMe() {
  const email = myEmail();
  if (!email || !loaded()) return;
  const p = PBStore.get('people', email), name = (window.PBAuth && PBAuth.name()) || email, t = today();
  if (p && p.name === name && p.seenAt === t) return;
  PBStore.save('people', { ...(p || { id: email, email, createdAt: nowIso() }), name, seenAt: t, updatedAt: nowIso() });
}

function renderDaily() {
  const date = S.dday;
  $('#dday').value = date;
  $('#ddayinfo').textContent = (date === today() ? '今天 · ' : '') + wk(date);
  $('#dtodayBtn').hidden = date === today();
  if (!canTask() && S.dmode === 'team') S.dmode = 'me';
  $('#dseg').hidden = !canTask();
  $$('[data-dmode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dmode === S.dmode)));
  $('#taskSetBtn').hidden = !canTask();
  const root = $('#dailyBody');
  if (!loaded() && !D.tasks().length && !D.daily().length) { root.innerHTML = loadingBox('每日工作'); return; }
  keepInputs(root, () => { root.innerHTML = S.dmode === 'team' ? teamHtml(date) : myDayHtml(date); });
}

function boardHints() {
  const live = D.orders().filter(o => o.progress !== 'cancelled'), h = [];
  const ap = live.filter(canApprove).length;
  if (ap) h.push(`<button type="button" class="hchip" data-go="approvals">待你簽核 ${ap} 筆</button>`);
  if (can('order')) {
    const to = live.filter(o => o.progress === 'todo' && o.approval === 'approved').length;
    const ov = live.filter(isOverdue).length;
    if (to) h.push(`<button type="button" class="hchip" data-goflag="toorder">已核准待叫貨 ${to} 筆</button>`);
    if (ov) h.push(`<button type="button" class="hchip bad" data-goflag="overdue">逾期未到貨 ${ov} 筆</button>`);
  }
  return h.length ? `<div class="hintbar">看板上待處理：${h.join('')}</div>` : '';
}

function myDayHtml(date) {
  const email = myEmail(), info = dayItems(date, email), r = info.rec, st = dayState(info);
  const future = date > today(), locked = future || !!(r && (r.doneAt || r.confirmAt));
  const noTasks = !D.tasks().some(t => !t.end || t.end >= today());
  const setup = noTasks ? `<div class="empty"><h3>還沒有設定每日工作項目</h3>
      <p>${canTask() ? '把每天固定要做的事設定成工作項目，之後每個人打開這裡就會看到自己的清單：做完打勾，下班前按「確認工作完成」，主管再到「團隊確認」確認。' : '請主管設定每日工作項目。設定好之後，你每天打開這裡就會看到自己的清單。'}</p>
      ${canTask() ? '<div class="row"><button class="btn primary" type="button" data-dact="preset">套用建議的採購每日工作</button><button class="btn" type="button" data-dact="settings">自己設定工作項目</button></div><p class="small">建議項目可以再修改、停用，也可以只指派給特定的人。</p>' : ''}
    </div>` : '';
  const rows = info.items.map(i => checkRow(i, locked, date)).join('');
  return `${setup}${date === today() ? boardHints() : ''}${dayEventsHint(date)}<div class="dsheet">
    <div class="dhead">
      <div class="dhead-t"><span class="chip ${st}">${STATE_LABEL[st]}</span><h2 class="h2">${esc(myName())} 的工作</h2></div>
      <div class="dprog"><span class="k-val">${info.done}<small>/ ${info.total} 項完成</small></span>${bar(info)}</div>
      ${r && r.confirmAt ? seal('確認', isoDay(r.confirmAt), 'lg') : ''}
    </div>
    ${r && r.returnNote && !r.doneAt ? `<div class="banner bad dret">主管退回：${esc(r.returnNote)}${r.returnBy ? `（${esc(r.returnBy)}）` : ''}。修改後再確認一次。</div>` : ''}
    <ul class="checks">${rows || `<li class="empty-row">${future ? '這天還沒到，到了當天才能打勾。' : '這天沒有指派給你的工作項目。可以在下面加入臨時工作。'}</li>`}</ul>
    ${locked ? '' : `<form class="addx" data-addx><input id="xtitle" maxlength="60" placeholder="新增臨時工作（只算這一天）" aria-label="臨時工作名稱" autocomplete="off" enterkeyhint="done"><button class="btn sm" type="submit">＋ 加入</button></form>`}
    ${future ? '' : confirmBlock(date, info)}
  </div>`;
}
function checkRow(i, locked, date) {
  const id = esc(i.id);
  return `<li class="ck${i.done ? ' done' : ''}">
    <label>${locked ? `<span class="ckbox lg" role="img" aria-label="${i.done ? '已完成' : '未完成'}">${i.done ? '✓' : ''}</span>` : `<input type="checkbox" ${i.kind === 'x' ? 'data-xcheck' : 'data-check'}="${id}"${i.done ? ' checked' : ''}>`}
      <span class="ck-t"><b>${esc(i.title)}</b>${i.kind === 'x' ? '<span class="tag-x">臨時</span>' : ''}${i.note ? `<small>${esc(i.note)}</small>` : ''}</span></label>
    ${i.done && i.at ? `<time title="打勾時間">${esc(doneAtText(i.at, date))}</time>` : ''}
    ${i.kind === 'x' && !locked ? `<button type="button" class="icon-btn sm" data-dact="xdel" data-id="${id}" aria-label="刪除 ${esc(i.title)}">×</button>` : ''}
  </li>`;
}
function confirmBlock(date, info) {
  const r = info.rec, left = info.total - info.done;
  if (r && r.confirmAt) return `<div class="next ok"><h3>主管已確認 · ${esc(r.confirmBy || '')} ${esc(stamp(r.confirmAt))}</h3>${r.note ? `<p class="hint">你的備註：${esc(r.note)}</p>` : ''}${r.confirmNote ? `<p class="hint">主管意見：${esc(r.confirmNote)}</p>` : ''}</div>`;
  if (r && r.doneAt) return `<div class="next"><h3>已確認完成 · ${esc(stamp(r.doneAt))}</h3>
    <p class="hint">${left ? `有 ${left} 項未完成，已附上原因。` : '全部完成。'}等主管確認；要修改的話先取消確認。</p>${r.note ? `<p class="hint">備註：${esc(r.note)}</p>` : ''}
    <div class="row"><button class="btn sm" type="button" data-dact="unconfirm">取消確認</button></div></div>`;
  if (!info.total) return '';
  const label = date === today() ? '確認今日工作完成' : `確認 ${md(date)} 工作完成`;
  return `<div class="next"><h3>${left ? `還有 ${left} 項沒打勾` : '全部完成了，按下面的按鈕確認'}</h3>
    <label class="f" for="dnote-me">工作備註${left ? '<span class="req">（有未完成的項目，請寫原因）</span>' : '（選填）'}<textarea id="dnote-me" rows="2" maxlength="300" placeholder="今天的狀況、未完成的原因、明天要接續的事">${esc((r && r.note) || '')}</textarea></label>
    <div class="row"><button class="btn primary" type="button" data-dact="confirm">${label}</button></div></div>`;
}

function teamFor(date) {
  const emails = new Set();
  for (const p of D.people()) if (!p.off) emails.add(p.email || p.id);
  for (const r of D.daily()) if (r.date === date) emails.add(r.email);
  return [...emails].map(email => { const info = dayItems(date, email); return { email, name: personName(email, info.rec), info, state: dayState(info) }; })
    .filter(x => x.info.total || x.info.rec)
    .sort((a, b) => (STATE_ORDER[a.state] - STATE_ORDER[b.state]) || cmpZh(a.name, b.name));
}
function teamHtml(date) {
  const rows = teamFor(date), future = date > today();
  if (!rows.length) {
    return `<div class="empty"><h3>${md(date)} 沒有人需要做每日工作</h3><p>${D.tasks().length ? '可能是這天沒有排工作（例如假日），或還沒有人登入過 App。同事登入過一次就會自動出現在名單上。' : '還沒有設定每日工作項目。'}</p>
      <div class="row"><button class="btn" type="button" data-dact="settings">工作項目設定</button></div></div>`;
  }
  const n = k => rows.filter(x => x.state === k).length;
  const left = rows.reduce((a, x) => a + (x.info.total - x.info.done), 0);
  const tiles = [
    { l: '要做每日工作', v: rows.length, u: '人', s: md(date) + ' ' + wk(date) },
    { l: '待主管確認', v: n('self'), u: '人', s: '已自行確認完成', tone: n('self') ? 'accent' : '' },
    { l: '主管已確認', v: n('mgr'), u: '人', s: rows.length ? `${Math.round(n('mgr') / rows.length * 100)}%` : '' },
    { l: '未完成項目', v: left, u: '項', s: `${n('todo')} 人還沒開始`, tone: left && !future && date < today() ? 'bad' : left ? 'warn' : '' },
  ];
  const bulk = future ? [] : rows.filter(x => x.state === 'self' && x.info.done >= x.info.total);
  const days = [...Array(7)].map((_, i) => addDays(date, i - 6));
  const strip = x => days.map(d => {
    const inf = d === date ? x.info : dayItems(d, x.email), s = dayState(inf);
    const tip = `${md(d)} ${wk(d)}：${STATE_LABEL[s]}${inf.total ? `（${inf.done}/${inf.total}）` : ''}`;
    return `<button type="button" class="dd s-${s}${d === date ? ' cur' : ''}" data-dday="${d}" title="${esc(tip)}" aria-label="${esc(tip)}"></button>`;
  }).join('');
  const row = x => {
    const r = x.info.rec;
    let act = '';
    if (x.state === 'mgr') act = seal('確認', isoDay(r.confirmAt), 'sm');
    else if (!future) act = `<button class="btn sm${x.state === 'self' ? ' primary' : ''}" type="button" data-dact="mgr-confirm" data-email="${esc(x.email)}"${x.state === 'self' ? '' : ' data-confirm="還沒自行確認，仍要確認？"'}>主管確認</button>`;
    return `<div class="arow trow">
      <div class="arow-main">
        <div class="meta-line"><span class="chip ${x.state}">${STATE_LABEL[x.state]}</span>${r && r.doneAt ? `<span>自行確認 ${esc(stamp(r.doneAt))}</span>` : ''}${r && r.returnNote && !r.doneAt ? '<span class="reason">已退回</span>' : ''}</div>
        <button type="button" class="card-title" data-dperson="${esc(x.email)}">${esc(x.name)}</button>
        <div class="tprog">${bar(x.info)}<span class="num">${x.info.done}/${x.info.total}</span></div>
        ${r && r.note ? `<div class="hint">備註：${esc(r.note)}</div>` : ''}
      </div>
      <div class="strip" role="group" aria-label="${esc(x.name)} 近 7 天">${strip(x)}</div>
      <div class="arow-act"><button class="btn sm" type="button" data-dperson="${esc(x.email)}">查看</button>${act}</div>
    </div>`;
  };
  return `<div class="kpis k4">${tiles.map(t => `<div class="kpi static ${t.tone || ''}"><span class="k-label">${esc(t.l)}</span><span class="k-val">${t.v}<small>${t.u}</small></span><span class="k-sub">${esc(t.s)}</span></div>`).join('')}</div>
    <div class="toolbar">
      <div class="legend"><span><span class="dd s-mgr"></span>主管已確認</span><span><span class="dd s-self"></span>待主管確認</span><span><span class="dd s-doing"></span>進行中／已打勾</span><span><span class="dd s-todo"></span>未開始</span><span>方格是近 7 天，點一下切換日期</span></div>
      <span class="spacer"></span>
      ${bulk.length ? `<button class="btn primary sm" type="button" data-dact="mgr-bulk">一次確認 ${bulk.length} 位全部完成的人</button>` : ''}
    </div>
    <div class="arows">${rows.map(row).join('')}</div>`;
}

const DLOG = { confirm: '確認工作完成', unconfirm: '取消確認', mgr: '主管確認', 'mgr-undo': '取消主管確認', return: '主管退回' };
const dlogLi = h => `<li><time>${esc(stamp(h.at))}</time><div><span>${esc(DLOG[h.act] || h.act)}</span>${h.by ? ` <span class="by">· ${esc(h.by)}</span>` : ''}${h.note ? `<div class="nt">「${esc(h.note)}」</div>` : ''}</div></li>`;
function personDayHtml(date, email) {
  const info = dayItems(date, email), r = info.rec, st = dayState(info), name = personName(email, r), e = esc(email);
  const rows = info.items.map(i => `<li class="ck${i.done ? ' done' : ''}"><span class="ckbox" role="img" aria-label="${i.done ? '已完成' : '未完成'}">${i.done ? '✓' : ''}</span>
    <span class="ck-t"><b>${esc(i.title)}</b>${i.kind === 'x' ? '<span class="tag-x">臨時</span>' : ''}</span>${i.done && i.at ? `<time>${esc(doneAtText(i.at, date))}</time>` : ''}</li>`).join('');
  let mgr = '';
  if (canTask() && date <= today()) {
    mgr = r && r.confirmAt
      ? `<div class="next ok"><h3>主管已確認 · ${esc(r.confirmBy || '')} ${esc(stamp(r.confirmAt))}</h3>${r.confirmNote ? `<p class="hint">主管意見：${esc(r.confirmNote)}</p>` : ''}<div class="row"><button class="btn sm" type="button" data-dact="mgr-undo" data-email="${e}" data-confirm="確定取消主管確認？">取消主管確認</button></div></div>`
      : `<div class="next"><h3>${r && r.doneAt ? '已自行確認完成，等你確認' : '還沒自行確認'}</h3><input id="mnote" class="inp" maxlength="200" placeholder="主管意見（退回時必填）" aria-label="主管意見">
        <div class="row"><button class="btn primary" type="button" data-dact="mgr-confirm" data-email="${e}" data-note="mnote">主管確認</button>${r && r.doneAt ? `<button class="btn danger" type="button" data-dact="mgr-return" data-email="${e}" data-note="mnote">退回</button>` : ''}</div></div>`;
  }
  return `<div class="dlg">
    <div class="dlg-head">
      <div><div class="eyebrow"><span>${md(date)} ${wk(date)}</span><span class="chip ${st}">${STATE_LABEL[st]}</span></div><h2>${esc(name)} 的工作</h2></div>
      ${r && r.confirmAt ? seal('確認', isoDay(r.confirmAt), 'lg') : ''}
      <button type="button" class="icon-btn" data-close aria-label="關閉">×</button>
    </div>
    <div class="dlg-body">
      <div class="dprog"><span class="k-val">${info.done}<small>/ ${info.total} 項完成</small></span>${bar(info)}</div>
      <ul class="checks ro">${rows || '<li class="empty-row">這天沒有工作項目。</li>'}</ul>
      ${r && r.note ? `<div class="next"><h3>${esc(name)} 的備註</h3><p>${esc(r.note)}</p></div>` : ''}
      ${mgr}
      ${r && r.log && r.log.length ? `<section><h3 class="sub-h">紀錄</h3><ol class="timeline">${r.log.slice().reverse().map(dlogLi).join('')}</ol></section>` : ''}
    </div>
    <div class="dlg-foot"><button class="btn primary" type="button" data-close>完成</button></div>
  </div>`;
}
function openPersonDay(email) {
  openDialog(personDayHtml(S.dday, email));
  S.dperson = email; S.dpday = S.dday;
}

function dailyAct(act, t) {
  const r = dailyAct0(act, t);
  // 主管在對話框裡確認／退回後立刻更新對話框（不等輸入框失焦）
  if (r && /^mgr-/.test(act) && dlg.open && S.dperson) dlg.innerHTML = personDayHtml(S.dpday, S.dperson);
  return r;
}
function dailyAct0(act, t) {
  const date = S.dperson && dlg.open ? S.dpday : S.dday, me = myEmail(), d = t.dataset;
  const needTask = () => { if (!canTask()) { toast('你沒有每日工作管理的權限。'); return false; } return true; };
  switch (act) {
    case 'settings': return openTaskSettings();
    case 'preset': return addPresetTasks();
    case 'xdel':
      return saveDay(date, me, r => { if (lockedMsg(r)) return false; r.extras = (r.extras || []).filter(x => x.id !== d.id); });
    case 'confirm': {
      const info = dayItems(date, me), left = info.total - info.done, el = $('#dnote-me'), note = el ? el.value.trim() : '';
      if (left && !note) { if (el) el.focus(); return toast(`還有 ${left} 項沒完成，請在備註寫原因再確認。`); }
      return saveDay(date, me, r => {
        if (lockedMsg(r)) return false;
        r.note = note; r.doneAt = nowIso(); r.due = dueFor(date, me, null); r.returnNote = '';
        logAdd(r, 'confirm', left ? note : '');
      }, left ? `已確認，${left} 項未完成的原因已送出` : '已確認完成，辛苦了！');
    }
    case 'unconfirm':
      return saveDay(date, me, r => {
        if (r.confirmAt) { toast('主管已確認，不能取消。'); return false; }
        if (!r.doneAt) return false;
        r.doneAt = null; delete r.due; logAdd(r, 'unconfirm');
      }, '已取消確認，可以繼續修改');
    case 'mgr-confirm': {
      if (!needTask()) return;
      const email = d.email, note = noteVal(t);
      return saveDay(date, email, r => {
        if (r.confirmAt) return false;
        if (!r.due) r.due = dueFor(date, email, null);
        r.confirmAt = nowIso(); r.confirmBy = myName(); r.confirmNote = note; r.returnNote = '';
        logAdd(r, 'mgr', note);
      }, `已確認 ${personName(email)} 的工作`);
    }
    case 'mgr-undo':
      if (!needTask()) return;
      return saveDay(date, d.email, r => {
        if (!r.confirmAt) return false;
        r.confirmAt = null; r.confirmBy = ''; r.confirmNote = '';
        if (!r.doneAt) delete r.due;
        logAdd(r, 'mgr-undo');
      }, '已取消主管確認');
    case 'mgr-return': {
      if (!needTask()) return;
      const note = noteVal(t);
      if (!note) { const el = document.getElementById(d.note); if (el) el.focus(); return toast('請填寫退回原因，讓對方知道要補什麼。'); }
      return saveDay(date, d.email, r => {
        r.doneAt = null; r.confirmAt = null; r.confirmBy = ''; delete r.due;
        r.returnNote = note; r.returnBy = myName();
        logAdd(r, 'return', note);
      }, `已退回給 ${personName(d.email)}`);
    }
    case 'mgr-bulk': {
      if (!needTask()) return;
      const list = teamFor(date).filter(x => x.state === 'self' && x.info.done >= x.info.total);
      const recs = list.map(x => dayNext(date, x.email, r => { r.confirmAt = nowIso(); r.confirmBy = myName(); r.confirmNote = ''; logAdd(r, 'mgr'); })).filter(Boolean);
      if (!recs.length) return;
      PBStore.saveMany('daily', recs);
      return toast(`已確認 ${recs.length} 位同事的工作`);
    }
  }
}
function onDailyChange(e) {
  const t = e.target, date = S.dday, me = myEmail();
  if (date > today() && (t.dataset.check || t.dataset.xcheck)) { t.checked = !t.checked; return toast('這天還沒到，到了當天才能打勾。'); }
  if (t.dataset.check) {
    const id = t.dataset.check, item = dayItems(date, me).items.find(i => i.id === id && i.kind === 't');
    const ok = saveDay(date, me, r => {
      if (lockedMsg(r)) return false;
      r.checks = r.checks || {};
      if (t.checked) r.checks[id] = { at: nowIso(), t: item ? item.title : '' }; else delete r.checks[id];
    });
    if (!ok) t.checked = !t.checked;
  } else if (t.dataset.xcheck) {
    const ok = saveDay(date, me, r => {
      if (lockedMsg(r)) return false;
      const x = (r.extras || []).find(x => x.id === t.dataset.xcheck);
      if (!x) return false;
      x.done = t.checked; x.at = t.checked ? nowIso() : null;
    });
    if (!ok) t.checked = !t.checked;
  } else if (t.id === 'dnote-me') {
    const v = t.value.trim();
    saveDay(date, me, r => { if (r.doneAt || r.confirmAt || (r.note || '') === v) return false; r.note = v; });
    return;
  } else return;
  if (t.checked) {
    const info = dayItems(date, me);
    if (info.total && info.done >= info.total) toast('全部完成！記得按「確認工作完成」。');
  }
}
function onDailySubmit(e) {
  if (!e.target.matches('[data-addx]')) return;
  e.preventDefault();
  const inp = $('#xtitle'), title = inp.value.trim();
  if (!title) return inp.focus();
  if (S.dday > today()) return toast('這天還沒到，到了當天才能加入。');
  const ok = saveDay(S.dday, myEmail(), r => { if (lockedMsg(r)) return false; r.extras = [...(r.extras || []), { id: rid(), title, done: false, at: null }]; });
  if (ok) { inp.value = ''; inp.focus(); }
}

/* 工作項目設定（每日工作管理權限） */
function openTaskSettings() {
  if (!canTask()) return toast('你沒有每日工作管理的權限。');
  const T = today(), tasks = D.tasks().slice().sort(taskSort);
  const active = tasks.filter(t => !t.end || t.end >= T), stopped = tasks.filter(t => t.end && t.end < T);
  const people = D.people().slice().sort((a, b) => cmpZh(a.name, b.name));
  const row = (t, i, arr) => `<div class="arow">
      <div class="arow-main"><b>${esc(t.title)}</b><span class="hint">${esc(whoText(t))} · ${esc(daysText(t.days))}${t.note ? ' · ' + esc(t.note) : ''}</span></div>
      <div class="row">
        <button class="icon-btn sm" type="button" data-tmove="-1" data-id="${esc(t.id)}" aria-label="往上移"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="icon-btn sm" type="button" data-tmove="1" data-id="${esc(t.id)}" aria-label="往下移"${i === arr.length - 1 ? ' disabled' : ''}>↓</button>
        <button class="btn sm" type="button" data-tedit="${esc(t.id)}">編輯</button>
        <button class="btn sm" type="button" data-tstop="${esc(t.id)}" data-confirm="確定停用？">停用</button>
      </div></div>`;
  openDialog(`<div class="dlg">
    <div class="dlg-head"><div><h2>每日工作項目設定</h2><p class="hint">設定每天固定要做的事。修改從今天起生效，已經確認過的日子保留當時的清單。</p></div><button type="button" class="icon-btn" data-close aria-label="關閉">×</button></div>
    <div class="dlg-body">
      <section class="asec"><div class="row between"><h3>使用中的項目 <span class="n">${active.length}</span></h3><button class="btn sm primary" type="button" data-tedit="">＋ 新增工作項目</button></div>
        <div class="arows">${active.map(row).join('') || '<p class="empty-row">還沒有項目。</p>'}</div>
        <div class="row"><button class="btn sm" type="button" data-dact="preset">${active.length ? '補上建議的採購每日工作' : '套用建議的採購每日工作'}</button></div></section>
      ${stopped.length ? `<section class="asec"><h3>已停用 <span class="n">${stopped.length}</span></h3><div class="arows">${stopped.map(t => `<div class="arow"><div class="arow-main"><b>${esc(t.title)}</b><span class="hint">停用於 ${md(addDays(t.end, 1))}</span></div>
        <div class="row"><button class="btn sm" type="button" data-trestore="${esc(t.id)}">恢復</button><button class="btn sm danger" type="button" data-tdel="${esc(t.id)}" data-confirm="確定刪除？">刪除</button></div></div>`).join('')}</div></section>` : ''}
      <section class="asec"><h3>誰要做每日工作</h3><p class="hint">登入過 App 的人會自動出現在這裡。取消勾選的人（例如老闆、只看資料的人）不會出現在「團隊確認」名單，也不會被「所有人」的項目排到。</p>
        <div class="f">${people.length ? `<div class="perm-list">${people.map(p => `<label class="perm" for="poff-${esc(p.id)}"><input type="checkbox" id="poff-${esc(p.id)}" data-poff="${esc(p.id)}"${p.off ? '' : ' checked'}><span><b>${esc(p.name || p.email)}</b><span>${esc(p.email)}${p.seenAt ? ' · 最近使用 ' + md(p.seenAt) : ''}</span></span></label>`).join('')}</div>` : '<p class="hint">還沒有人登入過。</p>'}</div></section>
    </div>
    <div class="dlg-foot"><button class="btn primary" type="button" data-close>完成</button></div>
  </div>`);
}
function openTaskForm(t) {
  if (!canTask()) return;
  const isEdit = !!t;
  t = t || { title: '', note: '', who: null, days: [1, 2, 3, 4, 5] };
  const specific = Array.isArray(t.who), days = Array.isArray(t.days) && t.days.length ? t.days : [0, 1, 2, 3, 4, 5, 6];
  const people = D.people().slice().sort((a, b) => cmpZh(a.name, b.name)).map(p => ({ email: p.email || p.id, name: p.name }));
  for (const e of specific ? t.who : []) if (!people.some(p => p.email === e)) people.push({ email: e, name: '' });
  openDialog(`<form id="taskForm" class="dlg" novalidate>
    <div class="dlg-head"><div><h2>${isEdit ? '編輯工作項目' : '新增工作項目'}</h2></div><button type="button" class="icon-btn" data-close aria-label="關閉">×</button></div>
    <div class="dlg-body form-grid">
      <label class="f span2" for="t-title"><span class="req">工作名稱</span><input id="t-title" maxlength="60" value="${esc(t.title)}" placeholder="例如：確認今日請購需求" autofocus></label>
      <label class="f span2" for="t-note">說明（選填）<input id="t-note" maxlength="120" value="${esc(t.note || '')}" placeholder="怎麼做、做到什麼程度算完成"></label>
      <div class="f span2">哪幾天要做<div class="wkpick" role="group" aria-label="星期">${WEEK_ORDER.map(x => `<label class="wk" for="t-wk${x}"><input type="checkbox" id="t-wk${x}" data-wk value="${x}"${days.includes(x) ? ' checked' : ''}><span>${WK[x]}</span></label>`).join('')}</div></div>
      <div class="f span2">誰要做
        <div class="radios"><label class="radio" for="t-who-all"><input type="radio" id="t-who-all" name="t-who" value="all"${specific ? '' : ' checked'}>所有人</label><label class="radio" for="t-who-some"><input type="radio" id="t-who-some" name="t-who" value="some"${specific ? ' checked' : ''}>指定人員</label></div>
        <div id="t-people" class="perm-list"${specific ? '' : ' hidden'}>${people.map(p => `<label class="perm" for="tp-${esc(p.email)}"><input type="checkbox" id="tp-${esc(p.email)}" data-tp value="${esc(p.email)}"${specific && t.who.includes(p.email) ? ' checked' : ''}><span><b>${esc(p.name || p.email)}</b><span>${esc(p.email)}</span></span></label>`).join('') || '<p class="hint">還沒有人登入過 App，暫時只能選「所有人」。</p>'}</div>
      </div>
      <p id="t-err" class="err span2" hidden></p>
    </div>
    <div class="dlg-foot">
      ${isEdit ? `<div class="left"><button class="btn sm" type="button" data-tstop="${esc(t.id)}" data-confirm="確定停用？">停用</button></div>` : ''}
      <button type="button" class="btn ghost" data-dact="settings">返回</button>
      <button type="submit" class="btn primary">儲存</button>
    </div>
  </form>`, () => {
    $$('input[name="t-who"]').forEach(r => r.addEventListener('change', () => { $('#t-people').hidden = !$('#t-who-some').checked; }));
    $('#taskForm').addEventListener('submit', e => {
      e.preventDefault();
      const err = $('#t-err'), fail = m => { err.textContent = m; err.hidden = false; };
      const title = $('#t-title').value.trim();
      if (!title) { $('#t-title').focus(); return fail('請填寫工作名稱。'); }
      let wks = $$('[data-wk]').filter(i => i.checked).map(i => +i.value);
      if (!wks.length) return fail('請至少選一天。');
      if (wks.length === 7) wks = [];
      const some = $('#t-who-some').checked, who = some ? $$('[data-tp]').filter(i => i.checked).map(i => i.value) : null;
      if (some && !who.length) return fail('請勾選要做這項工作的人，或改成「所有人」。');
      const data = { title, note: $('#t-note').value.trim(), days: wks, who, updatedAt: nowIso() };
      if (isEdit) upd('tasks', t.id, data, `已更新「${title}」`);
      else {
        const max = D.tasks().reduce((a, x) => Math.max(a, num(x.order)), 0);
        PBStore.save('tasks', { id: rid(), ...data, order: max + 10, start: today(), end: '', createdAt: nowIso() });
        toast(`已新增「${title}」`);
      }
      openTaskSettings();
    });
  });
}
function addPresetTasks() {
  if (!canTask()) return toast('你沒有每日工作管理的權限。');
  const T = today(), have = new Set(D.tasks().filter(t => !t.end || t.end >= T).map(t => t.title.trim()));
  let order = D.tasks().reduce((a, x) => Math.max(a, num(x.order)), 0);
  const recs = PRESET_TASKS.filter(([title]) => !have.has(title)).map(([title, note]) => ({ id: rid(), title, note, days: [1, 2, 3, 4, 5], who: null, order: order += 10, start: T, end: '', createdAt: nowIso(), updatedAt: nowIso() }));
  if (!recs.length) return toast('建議的項目都已經有了。');
  PBStore.saveMany('tasks', recs);
  toast(`已加入 ${recs.length} 個工作項目（週一至週五、所有人），可以再修改。`);
  if (dlg.open) openTaskSettings();
}
function taskSettingAct(d) {
  if (!canTask()) return toast('你沒有每日工作管理的權限。');
  const T = today();
  if ('tedit' in d) return openTaskForm(d.tedit ? PBStore.get('tasks', d.tedit) : null);
  if (d.tmove) {
    const list = D.tasks().filter(t => !t.end || t.end >= T).sort(taskSort);
    const i = list.findIndex(t => t.id === d.id), j = i + (+d.tmove);
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    PBStore.saveMany('tasks', list.map((t, k) => ({ ...t, order: (k + 1) * 10 })));
    return openTaskSettings();
  }
  if (d.tstop) {
    const t = PBStore.get('tasks', d.tstop); if (!t) return;
    const used = D.daily().some(r => (r.checks && r.checks[t.id]) || (r.due || []).some(x => x.id === t.id));
    if (!used && (t.start || T) >= T) { PBStore.remove('tasks', t.id); toast(`已刪除「${t.title}」（還沒有人用過）`); }
    else { upd('tasks', t.id, { end: addDays(T, -1), updatedAt: nowIso() }, `已停用「${t.title}」，從今天起不再排入`); }
    return openTaskSettings();
  }
  if (d.trestore) { const t = PBStore.get('tasks', d.trestore); if (t) upd('tasks', t.id, { end: '', start: t.start && t.start > T ? T : t.start, updatedAt: nowIso() }, `已恢復「${t.title}」`); return openTaskSettings(); }
  if (d.tdel) { const t = PBStore.get('tasks', d.tdel); if (t) { PBStore.remove('tasks', t.id); toast(`已刪除「${t.title}」，過去打勾的紀錄仍會保留`); } return openTaskSettings(); }
}
function onDialogChange(e) {
  const t = e.target;
  if (t.dataset.poff) { const p = PBStore.get('people', t.dataset.poff); if (p) upd('people', p.id, { off: !t.checked, updatedAt: nowIso() }, t.checked ? `${p.name || p.email} 會排入每日工作` : `${p.name || p.email} 不排入每日工作`); }
}

/* ---------- 行事曆 ---------- */
// 共用的團隊行事曆：每個人都能新增行程；建立的人、管理員和有「每日工作管理」權限的人可以修改刪除。
// 可以疊上「叫貨需求日」（未到貨的叫貨單），點一下開叫貨單。
const CAL_CATS = [
  { k: 'meet', label: '會議' },
  { k: 'visit', label: '廠商來訪' },
  { k: 'deliver', label: '交貨／到貨' },
  { k: 'remind', label: '提醒／截止' },
  { k: 'leave', label: '休假' },
  { k: 'other', label: '其他' },
];
const CAT_LABEL = Object.fromEntries(CAL_CATS.map(c => [c.k, c.label]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const evEnd = e => (e.end && e.end > e.date ? e.end : e.date);
const canEditEv = e => isAdmin() || canTask() || e.createdBy === myEmail();
const evTime = e => e.time ? e.time + (e.endTime ? '–' + e.endTime : '') : '全天';
const evRange = e => evEnd(e) !== e.date ? `${md(e.date)}–${md(evEnd(e))}` : `${md(e.date)} ${wk(e.date)}`;
const openOrder = o => !['received', 'cancelled'].includes(o.progress);
const itemTitle = it => it.type === 'ev' ? it.e.title : it.o.item;
const itemSort = (a, b) => ((a.type === 'ord') - (b.type === 'ord')) || cmpZh(a.type === 'ev' ? a.e.time || '' : '', b.type === 'ev' ? b.e.time || '' : '') || cmpZh(itemTitle(a), itemTitle(b));

// 某段日期內每天有哪些行程（跨天的行程每一天都列）
function calIndex(from, to) {
  const m = new Map(), add = (d, it) => { if (!m.has(d)) m.set(d, []); m.get(d).push(it); };
  for (const e of D.events()) {
    if (!e.date || evEnd(e) < from || e.date > to) continue;
    let d = e.date < from ? from : e.date, n = 0;
    const last = evEnd(e) > to ? to : evEnd(e);
    while (d <= last && n++ < 400) { add(d, { type: 'ev', e }); d = addDays(d, 1); }
  }
  if (S.corders) for (const o of D.orders()) if (o.needBy && o.needBy >= from && o.needBy <= to && openOrder(o)) add(o.needBy, { type: 'ord', o });
  for (const arr of m.values()) arr.sort(itemSort);
  return m;
}
function evChip(it, short) {
  if (it.type === 'ord') {
    const o = it.o, over = isOverdue(o);
    return `<button type="button" class="evc c-order${over ? ' over' : ''}" data-open="${esc(o.id)}" title="${esc(`需求日：${o.item} ${qtyf(o.qty)}${o.unit || ''}（${vendorName(o)}）${over ? '，已逾期' : ''}`)}">${short ? '' : `<span class="evc-t">到貨 ${esc(o.item)}</span>`}</button>`;
  }
  const e = it.e;
  return `<button type="button" class="evc c-${esc(e.cat || 'other')}" data-ev="${esc(e.id)}" title="${esc(`${evTime(e)} ${e.title}（${CAT_LABEL[e.cat] || '其他'}）`)}">${short ? '' : `<span class="evc-t">${e.time ? `<i>${esc(e.time)}</i>` : ''}${esc(e.title)}</span>`}</button>`;
}

function renderCalendar() {
  const [y, m] = S.cmonth.split('-').map(Number);
  $('#cmonthLabel').textContent = `${y} 年 ${m} 月`;
  $('#ctodayBtn').hidden = S.cmonth === today().slice(0, 7) && S.cday === today();
  $('#corders').checked = S.corders;
  const first = new Date(y, m - 1, 1), start = addDays(ymd(first), -first.getDay());
  let days = [...Array(42)].map((_, i) => addDays(start, i));
  const cut = days.findIndex((d, i) => i % 7 === 0 && d.slice(0, 7) > S.cmonth);
  if (cut > 0) days = days.slice(0, cut);
  const idx = calIndex(days[0], days[days.length - 1]), T = today();
  const cells = days.map(d => {
    const items = idx.get(d) || [], out = d.slice(0, 7) !== S.cmonth, n = items.length;
    const shown = items.slice(0, 3), more = n - shown.length;
    const label = `${+d.slice(5, 7)}月${+d.slice(8)}日 ${wk(d)}${n ? `，${n} 個行程` : ''}`;
    return `<div class="cell${out ? ' out' : ''}${d === T ? ' today' : ''}${d === S.cday ? ' sel' : ''}" data-cday="${d}">
      <button type="button" class="cell-n" data-cday="${d}" aria-label="${esc(label)}"${d === S.cday ? ' aria-pressed="true"' : ''}>${+d.slice(8)}</button>
      <div class="cell-items">${shown.map(it => evChip(it)).join('')}${more > 0 ? `<button type="button" class="evmore" data-cday="${d}">還有 ${more} 個</button>` : ''}</div>
      <div class="cell-dots" aria-hidden="true">${items.slice(0, 4).map(it => `<i class="c-${it.type === 'ord' ? 'order' : esc(it.e.cat || 'other')}"></i>`).join('')}</div>
    </div>`;
  }).join('');
  $('#calGrid').innerHTML = `<div class="cal" style="--rows:${days.length / 7}">
    ${[...WK].map((w, i) => `<div class="cal-h${i === 0 || i === 6 ? ' we' : ''}">${w}</div>`).join('')}${cells}</div>`;
  $('#calSide').innerHTML = agendaHtml();
}
function agendaRow(it, showDate) {
  if (it.type === 'ord') {
    const o = it.o, over = isOverdue(o);
    return `<div class="agrow"><span class="ag-time${over ? ' bad-t' : ''}">${showDate ? md(o.needBy) + '<br>' : ''}需求日</span>
      <button type="button" class="ag-main" data-open="${esc(o.id)}"><b><span class="dotc c-order"></span>到貨 ${esc(o.item)}${o.spec ? ` <span class="spec">${esc(o.spec)}</span>` : ''}</b>
      <span class="hint">${qtyf(o.qty)} ${esc(o.unit || '')} · ${esc(vendorName(o))} · ${esc(PROG_LABEL[o.progress] || '')}${over ? ' · <span class="bad-t">逾期</span>' : ''}</span></button></div>`;
  }
  const e = it.e;
  return `<div class="agrow"><span class="ag-time">${showDate ? esc(evEnd(e) !== e.date ? evRange(e) : md(e.date)) + '<br>' : ''}${esc(e.time || '全天')}${e.time && e.endTime ? `<br><span class="muted">${esc(e.endTime)}</span>` : ''}</span>
    <button type="button" class="ag-main" data-ev="${esc(e.id)}"><b><span class="dotc c-${esc(e.cat || 'other')}"></span>${esc(e.title)}</b>
    <span class="hint">${esc(CAT_LABEL[e.cat] || '其他')}${!showDate && evEnd(e) !== e.date ? ' · ' + esc(evRange(e)) : ''}${e.byName ? ' · ' + esc(e.byName) : ''}</span>${e.note ? `<span class="ag-note">${esc(e.note)}</span>` : ''}</button></div>`;
}
function agendaHtml() {
  const d = S.cday, items = calIndex(d, d).get(d) || [], T = today();
  const end = addDays(T, 14);
  const upcoming = D.events().filter(e => e.date && evEnd(e) >= T && e.date <= end && !(e.date <= d && d <= evEnd(e)))
    .sort((a, b) => cmpZh(a.date, b.date) || cmpZh(a.time || '', b.time || '')).slice(0, 8);
  return `<section class="agsec">
      <header class="ag-h"><h3>${md(d)} ${wk(d)}${d === T ? ' · 今天' : ''}</h3><button class="btn sm primary" type="button" data-newev="${d}">＋ 新增</button></header>
      <div class="ag-list">${items.map(it => agendaRow(it)).join('') || `<p class="empty-row">這天沒有行程。${!loaded() ? '（資料讀取中…）' : ''}</p>`}</div>
    </section>
    <section class="agsec">
      <header class="ag-h"><h3>接下來兩週</h3></header>
      <div class="ag-list">${upcoming.map(e => agendaRow({ type: 'ev', e }, true)).join('') || '<p class="empty-row">沒有其他行程。</p>'}</div>
    </section>`;
}

function evDetailHtml(e) {
  const can_ = canEditEv(e);
  return `<div class="dlg">
    <div class="dlg-head"><div><div class="eyebrow"><span class="dotc c-${esc(e.cat || 'other')}"></span><span>${esc(CAT_LABEL[e.cat] || '其他')}</span></div><h2>${esc(e.title)}</h2></div><button type="button" class="icon-btn" data-close aria-label="關閉">×</button></div>
    <div class="dlg-body">
      <dl class="facts">
        <div><dt>日期</dt><dd>${esc(evRange(e))}</dd></div>
        <div><dt>時間</dt><dd>${esc(evTime(e))}</dd></div>
        <div><dt>建立</dt><dd>${esc(e.byName || e.createdBy || '—')}</dd></div>
        ${e.note ? `<div class="span-all"><dt>說明</dt><dd class="pre">${esc(e.note)}</dd></div>` : ''}
      </dl>
      ${can_ ? '' : '<p class="hint">只有建立的人、管理員和每日工作主管可以修改這個行程。</p>'}
    </div>
    <div class="dlg-foot">
      ${can_ ? `<div class="left"><button class="btn sm danger" type="button" data-evdel="${esc(e.id)}" data-confirm="確定刪除？">刪除</button></div><button class="btn" type="button" data-evedit="${esc(e.id)}">修改</button>` : ''}
      <button class="btn primary" type="button" data-close>完成</button>
    </div>
  </div>`;
}
function openEventDetail(id) {
  const e = PBStore.get('events', id);
  if (!e) return toast('找不到這個行程，可能已被刪除。');
  openDialog(evDetailHtml(e));
}
function openEventForm(ev, date) {
  const isEdit = !!ev;
  if (isEdit && !canEditEv(ev)) return toast('只有建立的人、管理員和每日工作主管可以修改這個行程。');
  ev = ev || { title: '', date: date || S.cday || today(), end: '', time: '', endTime: '', cat: 'meet', note: '' };
  openDialog(`<form id="evForm" class="dlg" novalidate>
    <div class="dlg-head"><div><h2>${isEdit ? '修改行程' : '新增行程'}</h2></div><button type="button" class="icon-btn" data-close aria-label="關閉">×</button></div>
    <div class="dlg-body form-grid">
      <label class="f span2" for="e-title"><span class="req">標題</span><input id="e-title" maxlength="60" value="${esc(ev.title)}" placeholder="例如：大成五金來訪報價" autofocus></label>
      <label class="f" for="e-cat">類別<select id="e-cat">${CAL_CATS.map(c => `<option value="${c.k}"${c.k === (ev.cat || 'other') ? ' selected' : ''}>${c.label}</option>`).join('')}</select></label>
      <span class="f"></span>
      <label class="f" for="e-date"><span class="req">日期</span><input id="e-date" type="date" value="${esc(ev.date)}"></label>
      <label class="f" for="e-end">結束日期（跨天才填）<input id="e-end" type="date" value="${esc(ev.end && ev.end > ev.date ? ev.end : '')}"></label>
      <label class="f" for="e-time">開始時間（全天不用填）<input id="e-time" type="time" value="${esc(ev.time || '')}"></label>
      <label class="f" for="e-etime">結束時間<input id="e-etime" type="time" value="${esc(ev.endTime || '')}"></label>
      <label class="f span2" for="e-note">說明<textarea id="e-note" rows="3" maxlength="500" placeholder="地點、聯絡人、要準備的東西">${esc(ev.note || '')}</textarea></label>
      <p id="e-err" class="err span2" hidden></p>
    </div>
    <div class="dlg-foot">
      ${isEdit ? `<div class="left"><button class="btn sm danger" type="button" data-evdel="${esc(ev.id)}" data-confirm="確定刪除？">刪除</button></div>` : ''}
      <button type="button" class="btn ghost" data-close>取消</button>
      <button type="submit" class="btn primary">儲存</button>
    </div>
  </form>`, () => {
    $('#evForm').addEventListener('submit', e => {
      e.preventDefault();
      const g = id => $('#' + id).value.trim(), err = $('#e-err'), fail = (m, id) => { err.textContent = m; err.hidden = false; if (id) $('#' + id).focus(); };
      const title = g('e-title'), date = g('e-date'), end = g('e-end'), time = g('e-time'), endTime = g('e-etime');
      if (!title) return fail('請填寫標題。', 'e-title');
      if (!date) return fail('請選擇日期。', 'e-date');
      if (end && end < date) return fail('結束日期不能早於開始日期。', 'e-end');
      if (endTime && !time) return fail('有結束時間的話，也要填開始時間。', 'e-time');
      if (time && endTime && endTime <= time && !(end && end > date)) return fail('結束時間要晚於開始時間。', 'e-etime');
      const data = { title, cat: g('e-cat'), date, end: end && end > date ? end : '', time, endTime: time ? endTime : '', note: g('e-note'), updatedAt: nowIso() };
      closeDialog();
      S.cday = date; S.cmonth = date.slice(0, 7);
      if (isEdit) upd('events', ev.id, data, `已更新「${title}」`);
      else { PBStore.save('events', { id: rid(), ...data, createdBy: myEmail(), byName: myName(), createdAt: nowIso() }); toast(`已新增「${title}」`); }
      if (S.view === 'calendar') render();
    });
  });
}
function deleteEvent(id) {
  const e = PBStore.get('events', id);
  if (!e) return closeDialog();
  if (!canEditEv(e)) return toast('只有建立的人、管理員和每日工作主管可以刪除這個行程。');
  closeDialog();
  PBStore.remove('events', id);
  toast(`已刪除「${e.title}」`);
}
// 每日工作頁上方：這天的行程
function dayEventsHint(date) {
  const items = (calIndex(date, date).get(date) || []).filter(it => it.type === 'ev');
  if (!items.length) return '';
  return `<div class="hintbar dayev">${date === today() ? '今天' : md(date)}的行程：${items.map(({ e }) => `<button type="button" class="hchip ev c-${esc(e.cat || 'other')}" data-ev="${esc(e.id)}"><span class="dotc c-${esc(e.cat || 'other')}"></span>${e.time ? esc(e.time) + ' ' : ''}${esc(e.title)}</button>`).join('')}</div>`;
}

/* ---------- 原物料分析（公司內部原料 × 廠商報價） ---------- */
// 公司內部原料清單（materials）用品名＋其他名稱比對廠商產品，檢核：有沒有供應商、是不是單一來源、
// 規格和單位是否一致、最小訂量（MOQ）換算成幾個月的用量；並列出廠商聯絡方式。
const MOQ_MONTHS = 3; // MOQ 超過幾個月用量算偏高
const MFLAG = {
  none: { label: '無供應商', tone: 'bad' },
  spec: { label: '規格都不符', tone: 'warn' },
  single: { label: '單一來源', tone: 'warn' },
  moq: { label: 'MOQ 偏高', tone: 'warn' },
  unit: { label: '單位不同', tone: 'warn' },
};
const MFLAG_ORDER = ['none', 'spec', 'single', 'moq', 'unit'];
const normKey = s => String(s ?? '').toLowerCase().replace(/[\s　\-_/\\()（）［］\[\]·・.,，、]/g, '');
const matNames = m => [m.name, ...String(m.alias || '').split(/[,，、;；]/)].map(normKey).filter(Boolean);
const monthsText = x => x == null ? '' : x < 0.1 ? '不到 0.1 個月' : `約 ${x < 10 ? x.toFixed(1) : Math.round(x)} 個月`;
function matAnalysis(m) {
  const names = new Set(matNames(m));
  const offers = D.products().filter(p => names.has(normKey(p.name))).map(p => {
    const specOk = !m.spec || !p.spec || normKey(p.spec) === normKey(m.spec);
    const unitOk = !m.unit || !p.unit || normKey(p.unit) === normKey(m.unit);
    const months = num(m.usage) > 0 && num(p.moq) > 0 && unitOk ? num(p.moq) / num(m.usage) : null;
    return { p, v: vById.get(p.vendorId) || null, specOk, unitOk, months };
  }).sort((a, b) => (b.specOk - a.specOk) || offerSort(a.p, b.p));
  const good = offers.filter(o => o.specOk);
  const best = (good.length ? good : offers)[0] || null;
  const goodVendors = new Set(good.map(o => o.p.vendorId)).size;
  const ms = good.map(o => o.months).filter(x => x != null);
  const minMonths = ms.length ? Math.min(...ms) : null;
  const flags = [];
  if (!offers.length) flags.push('none');
  else {
    if (!good.length) flags.push('spec');
    else if (goodVendors === 1) flags.push('single');
    if (minMonths != null && minMonths > MOQ_MONTHS) flags.push('moq');
    if (offers.some(o => !o.unitOk)) flags.push('unit');
  }
  return { m, offers, good, best, goodVendors, vendors: new Set(offers.map(o => o.p.vendorId)).size, minMonths, flags };
}
const flagChips = a => a.flags.length ? a.flags.map(f => `<span class="chip ${MFLAG[f].tone}">${MFLAG[f].label}</span>`).join('') : '<span class="chip on">正常</span>';
const contactOf = v => v ? [v.contact, v.phone].filter(Boolean).join(' · ') : '';

function renderMaterials() {
  const mats = D.materials(), root = $('#matBody');
  $('#matTools').hidden = !can('vendor');
  if (!mats.length) {
    root.innerHTML = !loaded() ? loadingBox('原料清單') : `<div class="empty"><h3>還沒有公司內部原料清單</h3>
      <p>把公司平常用的原物料（料號、品名、規格、單位、每月用量）建成清單，這裡會自動和廠商產品比對：哪些原料有幾家廠商供應、最低價和聯絡窗口、最小訂量（MOQ）夠用幾個月，並標出「無供應商」「單一來源」「MOQ 偏高」「規格／單位不符」的原料。</p>
      <div class="row">${can('vendor') ? '<button class="btn primary" type="button" data-import-mat>從 Excel 貼上原料清單</button><button class="btn" type="button" data-add-mat>新增原料</button>' : '<span class="hint">請有「廠商產品維護」權限的同事建立原料清單。</span>'}${isAdmin() ? '<button class="btn" type="button" data-mat-sample>載入範例原料清單</button>' : ''}</div>
      ${isAdmin() ? '<p class="small">範例原料都會標上「範例」，可以和其他範例資料一起清除。</p>' : ''}</div>`;
    return;
  }
  const all = mats.map(matAnalysis);
  const cnt = f => all.filter(a => a.flags.includes(f)).length;
  const covered = all.filter(a => a.offers.length).length;
  const tiles = [
    { k: '', label: '內部原料', val: all.length, unit: '項', sub: `${covered} 項有廠商報價` },
    { k: 'attn', label: '需要注意', val: all.filter(a => a.flags.length).length, unit: '項', sub: '有任何一項檢核不通過', tone: all.some(a => a.flags.length) ? 'warn' : '' },
    { k: 'none', label: '無供應商', val: cnt('none'), unit: '項', sub: '廠商產品裡找不到', tone: cnt('none') ? 'bad' : '' },
    { k: 'single', label: '單一來源', val: cnt('single'), unit: '項', sub: '只有一家規格相符', tone: cnt('single') ? 'warn' : '' },
    { k: 'moq', label: 'MOQ 偏高', val: cnt('moq'), unit: '項', sub: `最小訂量超過 ${MOQ_MONTHS} 個月用量`, tone: cnt('moq') ? 'warn' : '' },
  ];
  let list = all;
  if (S.mflag === 'attn') list = list.filter(a => a.flags.length);
  else if (S.mflag === 'specunit') list = list.filter(a => a.flags.includes('spec') || a.flags.includes('unit'));
  else if (S.mflag) list = list.filter(a => a.flags.includes(S.mflag));
  if (S.mq) {
    const q = S.mq.toLowerCase();
    list = list.filter(a => [a.m.code, a.m.name, a.m.alias, a.m.spec, a.m.category, ...a.offers.map(o => o.v && o.v.name)].some(x => String(x || '').toLowerCase().includes(q)));
  }
  const rank = a => a.flags.length ? Math.min(...a.flags.map(f => MFLAG_ORDER.indexOf(f))) : 99;
  list = list.slice().sort((a, b) => (rank(a) - rank(b)) || cmpZh(a.m.code || a.m.name, b.m.code || b.m.name));
  const chipsF = [['', '全部'], ['attn', '需要注意'], ['none', '無供應商'], ['single', '單一來源'], ['moq', 'MOQ 偏高'], ['specunit', '規格／單位不符']];
  const rows = list.map(a => {
    const m = a.m, b = a.best, id = esc(m.id);
    const names = [...new Set(a.good.map(o => o.v ? o.v.name : '（已刪除的廠商）'))];
    return `<tr>
      <td class="mono muted">${esc(m.code || '—')}</td>
      <td><button type="button" class="link" data-mat="${id}">${esc(m.name)}</button> ${sampleTag(m)}<div class="muted small2">${esc([m.spec, m.category].filter(Boolean).join(' · ') || '—')}</div></td>
      <td class="r num">${num(m.usage) ? qtyf(m.usage) + ' <small>' + esc(m.unit || '') + '</small>' : '<span class="muted">—</span>'}</td>
      <td>${a.goodVendors ? `<b class="num">${a.goodVendors}</b> 家<div class="muted small2">${esc(names.slice(0, 2).join('、'))}${names.length > 2 ? ' 等' : ''}</div>` : a.offers.length ? `<span class="muted">${a.vendors} 家（規格不同）</span>` : '<span class="bad-t">無</span>'}</td>
      <td class="r num">${b ? `${priceCell(b.p)}<div class="muted small2">${esc(b.v ? b.v.name : '')}</div>` : '—'}</td>
      <td class="r num">${b && num(b.p.moq) ? `${qtyf(b.p.moq)} <small>${esc(b.p.unit || '')}</small>${b.months != null ? `<div class="small2 ${b.months > MOQ_MONTHS ? 'warn-t' : 'muted'}">${monthsText(b.months)}</div>` : ''}` : '—'}</td>
      <td class="r num">${b && num(b.p.leadDays) ? qtyf(b.p.leadDays) + ' <small>天</small>' : '—'}</td>
      <td>${b && b.v ? `${esc(b.v.contact || '—')}${b.v.phone ? `<div class="small2"><a class="mono" href="tel:${esc(b.v.phone.replace(/[^\d+]/g, ''))}">${esc(b.v.phone)}</a></div>` : ''}` : '—'}</td>
      <td><span class="flags">${flagChips(a)}</span></td>
    </tr>`;
  }).join('');
  // 反向檢核：廠商有賣、但不在內部原料清單的產品
  const known = new Set(mats.flatMap(matNames));
  const extra = new Map();
  for (const p of D.products()) { const k = normKey(p.name); if (!k || known.has(k)) continue; if (!extra.has(k)) extra.set(k, { p, vs: new Set() }); extra.get(k).vs.add(p.vendorId); }
  const extras = [...extra.values()].sort((a, b) => cmpZh(a.p.name, b.p.name));
  root.innerHTML = `<div class="kpis">${tiles.map(t => `<button type="button" class="kpi ${t.tone || ''}${(S.mflag || '') === t.k ? ' on' : ''}" data-mflag="${t.k}"><span class="k-label">${esc(t.label)}</span><span class="k-val">${t.val}<small>${t.unit}</small></span><span class="k-sub">${esc(t.sub)}</span></button>`).join('')}</div>
    <div class="cats">${chipsF.map(([k, l]) => `<button type="button" class="chipbtn${(S.mflag || '') === k ? ' on' : ''}" data-mflag="${k}">${l}</button>`).join('')}</div>
    ${list.length ? `<div class="pgroup"><div class="tscroll"><table class="pt mt"><thead><tr><th>料號</th><th>原料</th><th class="r">月用量</th><th>供應廠商</th><th class="r">最低單價</th><th class="r">MOQ</th><th class="r">交期</th><th>聯絡窗口</th><th>檢核</th></tr></thead><tbody>${rows}</tbody></table></div></div>
      <p class="hint">比對方式：原料的「品名」或「其他名稱」和廠商產品的品名相同就算同一種（不分大小寫、空白和標點）。最低單價、MOQ、交期、聯絡窗口取規格相符、價格最低的那家。點原料名稱看每一家的完整報價和聯絡方式。</p>`
      : `<div class="empty"><h3>沒有符合條件的原料</h3><p>換個篩選條件或關鍵字試試。</p></div>`}
    ${extras.length ? `<details class="asec mextra"><summary><h3>廠商有賣、但不在內部原料清單的產品 <span class="n">${extras.length}</span></h3></summary>
      <p class="hint">可能是清單漏列，或品名寫法不同（可以在原料的「其他名稱」補上）。${can('vendor') ? '點一下可以直接加進原料清單。' : ''}</p>
      <div class="cats">${extras.map(x => can('vendor')
        ? `<button type="button" class="chipbtn" data-mat-from="${esc(x.p.id)}">＋ ${esc(x.p.name)} <span class="muted">${x.vs.size} 家</span></button>`
        : `<span class="chipbtn">${esc(x.p.name)} <span class="muted">${x.vs.size} 家</span></span>`).join('')}</div></details>` : ''}`;
}

function matDetailHtml(id) {
  const m = PBStore.get('materials', id);
  if (!m) return `<div class="dlg"><div class="dlg-head"><div><h2>找不到這項原料</h2><p class="hint">可能已經被刪除。</p></div><button type="button" class="icon-btn" data-close aria-label="關閉">×</button></div></div>`;
  const a = matAnalysis(m), mid = esc(m.id);
  const checks = [
    a.offers.length ? (a.goodVendors >= 2 ? ['ok', `有 ${a.goodVendors} 家廠商供應規格相符的產品`] : a.goodVendors === 1 ? ['warn', '只有 1 家廠商供應規格相符的產品（單一來源），建議再找備用廠商'] : ['warn', `有 ${a.vendors} 家廠商賣同名產品，但規格都和內部規格不同`]) : ['bad', '廠商產品裡找不到這項原料，需要開發供應商，或在「其他名稱」補上廠商用的品名'],
    m.spec ? (a.offers.every(o => o.specOk) ? (a.offers.length ? ['ok', '規格和內部規格一致'] : null) : ['warn', `${a.offers.filter(o => !o.specOk).length} 筆報價規格不同（下表標「規格不同」）`]) : ['info', '內部清單沒有填規格，無法檢核規格'],
    a.offers.some(o => !o.unitOk) ? ['warn', '有報價的單位和內部單位不同，MOQ 和價格要換算後再比'] : (a.offers.length && m.unit ? ['ok', '單位一致'] : null),
    !num(m.usage) ? ['info', '沒有填每月用量，無法檢核 MOQ'] : a.minMonths == null ? (a.good.length ? ['info', '廠商沒有填最小訂量'] : null) : a.minMonths > MOQ_MONTHS ? ['warn', `最小訂量最少也要${monthsText(a.minMonths).replace('約 ', ' ')}的用量（超過 ${MOQ_MONTHS} 個月），注意庫存和資金積壓`] : ['ok', `最小訂量最少約 ${monthsText(a.minMonths).replace('約 ', '')}用量，在 ${MOQ_MONTHS} 個月內`],
  ].filter(Boolean);
  const mark = { ok: '✓', warn: '!', bad: '×', info: 'i' };
  const offerRows = a.offers.map((o, i) => {
    const p = o.p, v = o.v || {};
    return `<tr>
      <td><button type="button" class="link" data-vendor="${esc(p.vendorId)}">${esc(v.name || '（已刪除的廠商）')}</button>${o === a.best && isQuote(p) ? '<span class="best">最低</span>' : ''}</td>
      <td>${esc(p.spec || '—')}${o.specOk ? '' : ' <span class="chip warn">規格不同</span>'}</td>
      <td class="r num">${priceCell(p)}${o.unitOk ? '' : ' <span class="chip warn">單位不同</span>'}</td>
      <td class="r num">${num(p.moq) ? qtyf(p.moq) : '—'}${o.months != null ? `<div class="small2 ${o.months > MOQ_MONTHS ? 'warn-t' : 'muted'}">${monthsText(o.months)}</div>` : ''}</td>
      <td class="r num">${num(p.leadDays) ? qtyf(p.leadDays) + ' 天' : '—'}</td>
      <td>${esc(v.contact || '—')}${v.phone ? `<div class="small2"><a class="mono" href="tel:${esc(v.phone.replace(/[^\d+]/g, ''))}">${esc(v.phone)}</a></div>` : ''}${v.email ? `<div class="small2"><a href="mailto:${esc(v.email)}">${esc(v.email)}</a></div>` : ''}</td>
      <td>${esc(v.terms || '—')}</td>
      ${can('order') ? `<td class="r"><button class="btn sm" type="button" data-order-product="${esc(p.id)}">叫貨</button></td>` : ''}
    </tr>`;
  }).join('');
  const fact = (k, val) => `<div><dt>${k}</dt><dd>${val}</dd></div>`;
  return `<div class="dlg wide">
    <div class="dlg-head"><div><div class="eyebrow"><span class="po">${esc(m.code || '未填料號')}</span>${sampleTag(m)}<span class="flags">${flagChips(a)}</span></div><h2>${esc(m.name)}${m.spec ? ` <span class="spec">${esc(m.spec)}</span>` : ''}</h2></div><button type="button" class="icon-btn" data-close aria-label="關閉">×</button></div>
    <div class="dlg-body">
      <dl class="facts">
        ${fact('分類', esc(m.category || '—'))}${fact('單位', esc(m.unit || '—'))}${fact('每月用量', num(m.usage) ? `<span class="num">${qtyf(m.usage)}</span> ${esc(m.unit || '')}` : '—')}
        ${m.alias ? `<div class="span-all"><dt>其他名稱</dt><dd>${esc(m.alias)}</dd></div>` : ''}
        ${m.note ? `<div class="span-all"><dt>備註</dt><dd class="pre">${esc(m.note)}</dd></div>` : ''}
      </dl>
      <section><h3 class="sub-h">檢核結果</h3><ul class="mchecks">${checks.map(([t, s]) => `<li class="${t}"><span class="mk" aria-hidden="true">${mark[t]}</span><span>${esc(s)}</span></li>`).join('')}</ul></section>
      <section><h3 class="sub-h">廠商報價與聯絡方式（${a.offers.length} 筆）</h3>
        ${a.offers.length ? `<div class="tscroll"><table class="pt"><thead><tr><th>廠商</th><th>規格</th><th class="r">單價</th><th class="r">MOQ</th><th class="r">交期</th><th>聯絡人／電話／Email</th><th>付款條件</th>${can('order') ? '<th></th>' : ''}</tr></thead><tbody>${offerRows}</tbody></table></div>` : '<p class="hint">還沒有廠商報價。</p>'}
      </section>
    </div>
    <div class="dlg-foot">
      ${can('vendor') ? `<div class="left"><button class="btn sm danger" type="button" data-act="delete-material" data-id="${mid}" data-confirm="確定刪除？">刪除原料</button></div><button class="btn" type="button" data-edit-mat="${mid}">編輯原料</button>` : ''}
      <button class="btn primary" type="button" data-close>完成</button>
    </div>
  </div>`;
}
function openMatDetail(id) { openDialog(matDetailHtml(id)); }

function openMatForm(m, pre) {
  if (!can('vendor')) return toast('你沒有維護原料清單的權限（廠商產品維護）。');
  const isEdit = !!(m && m.id);
  const v = m || pre || {};
  const cats = [...new Set(D.materials().map(x => x.category).concat(D.products().map(x => x.category)).filter(Boolean))].sort(cmpZh);
  openDialog(`<form id="matForm" class="dlg" novalidate>
    <div class="dlg-head"><div><h2>${isEdit ? '編輯原料' : '新增原料'}</h2><p class="hint">品名或其他名稱和廠商產品相同，就會自動比對報價。</p></div><button type="button" class="icon-btn" data-close aria-label="關閉">×</button></div>
    <div class="dlg-body form-grid">
      <label class="f" for="m-code">料號<input id="m-code" maxlength="40" value="${esc(v.code || '')}" placeholder="例如：RM-001"></label>
      <label class="f" for="m-name"><span class="req">品名</span><input id="m-name" maxlength="60" value="${esc(v.name || '')}" ${isEdit ? '' : 'autofocus'}></label>
      <label class="f span2" for="m-alias">其他名稱（廠商用的不同品名，用逗號分開）<input id="m-alias" maxlength="200" value="${esc(v.alias || '')}" placeholder="例如：工作手套, 棉手套"></label>
      <label class="f span2" for="m-spec">規格<input id="m-spec" maxlength="80" value="${esc(v.spec || '')}" placeholder="和廠商報價的規格寫法一致，才能檢核規格"></label>
      <label class="f" for="m-cat">分類<input id="m-cat" maxlength="30" value="${esc(v.category || '')}" list="dl-mcats" autocomplete="off"></label>
      <datalist id="dl-mcats">${cats.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      <label class="f" for="m-unit">單位<input id="m-unit" maxlength="10" value="${esc(v.unit || '')}" placeholder="支、個、kg"></label>
      <label class="f" for="m-usage">每月用量（用來檢核 MOQ）<input id="m-usage" type="number" min="0" step="any" inputmode="decimal" value="${esc(v.usage || '')}"></label>
      <span class="f"></span>
      <label class="f span2" for="m-note">備註<textarea id="m-note" rows="2" maxlength="300">${esc(v.note || '')}</textarea></label>
      <p id="m-err" class="err span2" hidden></p>
    </div>
    <div class="dlg-foot">
      ${isEdit ? `<div class="left"><button class="btn sm danger" type="button" data-act="delete-material" data-id="${esc(m.id)}" data-confirm="確定刪除？">刪除原料</button></div>` : ''}
      <button type="button" class="btn ghost" data-close>取消</button>
      <button type="submit" class="btn primary">儲存</button>
    </div>
  </form>`, () => {
    $('#matForm').addEventListener('submit', e => {
      e.preventDefault();
      const g = id => $('#' + id).value.trim(), err = $('#m-err'), fail = (t, id) => { err.textContent = t; err.hidden = false; if (id) $('#' + id).focus(); };
      const name = g('m-name'), code = g('m-code');
      if (!name) return fail('請填寫品名。', 'm-name');
      if (code && D.materials().some(x => x.id !== (m && m.id) && normKey(x.code) === normKey(code))) return fail('已經有相同料號的原料。', 'm-code');
      const data = { code, name, alias: g('m-alias'), spec: g('m-spec'), category: g('m-cat'), unit: g('m-unit'), usage: num(g('m-usage')), note: g('m-note'), updatedAt: nowIso() };
      closeDialog();
      if (isEdit) { upd('materials', m.id, data, `已更新 ${name}`); openMatDetail(m.id); }
      else { const id = rid(); PBStore.save('materials', { id, ...data, createdAt: nowIso() }); toast(`已加入原料 ${name}`); openMatDetail(id); }
    });
  });
}
function parseMatImport(text) {
  const rows = text.split(/\r?\n/).filter(l => l.trim()).map(l => (l.includes('\t') ? l.split('\t') : l.split(',')).map(c => c.trim().replace(/^"|"$/g, '')));
  if (rows.length && (/料號|編號|品號|code/i.test(rows[0][0] || '') || /品名/.test(rows[0][1] || ''))) rows.shift();
  return rows.map(r => ({ code: r[0] || '', name: r[1] || '', spec: r[2] || '', category: r[3] || '', unit: r[4] || '', usage: num(r[5]), alias: r[6] || '' })).filter(r => r.name);
}
function openMatImport() {
  if (!can('vendor')) return toast('你沒有維護原料清單的權限（廠商產品維護）。');
  openDialog(`<div class="dlg">
    <div class="dlg-head"><div><h2>從 Excel 貼上原料清單</h2><p class="hint">在 Excel 選取表格範圍、複製，貼到下面。每一列一項原料，欄位順序如下（第一列是標題也沒關係）：</p></div><button type="button" class="icon-btn" data-close aria-label="關閉">×</button></div>
    <div class="dlg-body">
      <div class="imp-cols">料號 ⇥ 品名 ⇥ 規格 ⇥ 分類 ⇥ 單位 ⇥ 每月用量 ⇥ 其他名稱</div>
      <textarea id="mimp-text" class="imp-text" placeholder="RM-001	不鏽鋼螺絲	M6×20 SUS304	五金	支	3000" aria-label="貼上表格內容"></textarea>
      <p id="mimp-sum" class="hint">還沒有內容。</p>
      <p class="hint">料號相同的會更新；沒有料號的，同品名、同規格會更新，不會重複新增。</p>
    </div>
    <div class="dlg-foot"><button type="button" class="btn ghost" data-close>取消</button><button type="button" class="btn primary" id="mimp-go" disabled>匯入</button></div>
  </div>`, () => {
    const ta = $('#mimp-text'), sum = $('#mimp-sum'), go = $('#mimp-go');
    let rows = [];
    ta.addEventListener('input', () => {
      rows = parseMatImport(ta.value);
      sum.textContent = rows.length ? `讀到 ${rows.length} 項原料。` : (ta.value.trim() ? '讀不到資料：每一列至少要有「品名」（第二欄）。' : '還沒有內容。');
      go.disabled = !rows.length;
    });
    go.addEventListener('click', () => {
      const cur = D.materials(), out = new Map();
      let added = 0, updated = 0;
      for (const r of rows) {
        const key = r.code ? 'c:' + normKey(r.code) : 'n:' + normKey(r.name) + '|' + normKey(r.spec);
        const body = { ...r, updatedAt: nowIso() };
        if (out.has(key)) { Object.assign(out.get(key), body); continue; }
        const ex = cur.find(x => r.code ? normKey(x.code) === normKey(r.code) : (!x.code && normKey(x.name) === normKey(r.name) && normKey(x.spec) === normKey(r.spec)));
        if (ex) { updated++; out.set(key, { ...ex, ...body, alias: r.alias || ex.alias || '' }); }
        else { added++; out.set(key, { id: rid(), ...body, note: '', createdAt: nowIso() }); }
      }
      PBStore.saveMany('materials', [...out.values()]);
      closeDialog();
      toast(`匯入完成：新增 ${added} 項、更新 ${updated} 項原料。`);
      S.vmode = 'materials'; S.mflag = ''; S.mq = ''; $('#mq').value = '';
      if (S.view !== 'vendors') location.hash = 'vendors'; else render();
    });
    ta.focus();
  });
}
function exportMatCsv() {
  const all = D.materials().map(matAnalysis).sort((a, b) => cmpZh(a.m.code || a.m.name, b.m.code || b.m.name));
  if (!all.length) return toast('還沒有原料可以匯出。');
  const cell = c => { let s = String(c ?? ''); if (/^[=+@]/.test(s) || /^-[^\d]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['料號', '品名', '規格', '分類', '單位', '每月用量', '規格相符廠商數', '最低價廠商', '最低單價', '報價單位', 'MOQ', 'MOQ可用月數', '交期(天)', '聯絡人', '電話', 'Email', '付款條件', '檢核結果'];
  const rows = all.map(a => {
    const m = a.m, b = a.best, v = (b && b.v) || {};
    return [m.code, m.name, m.spec, m.category, m.unit, m.usage || '', a.goodVendors, v.name || '', b && num(b.p.price) > 0 ? b.p.price : '', b ? b.p.unit : '', b ? b.p.moq || '' : '', b && b.months != null ? b.months.toFixed(1) : '', b ? b.p.leadDays || '' : '', v.contact || '', v.phone || '', v.email || '', v.terms || '', a.flags.length ? a.flags.map(f => MFLAG[f].label).join('、') : '正常'];
  });
  const csv = '﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
  const el = document.createElement('a');
  el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  el.download = `原物料分析_${today()}.csv`;
  document.body.appendChild(el); el.click();
  setTimeout(() => { URL.revokeObjectURL(el.href); el.remove(); }, 1500);
  toast(`已匯出 ${all.length} 項原料的分析。`);
}
function loadSampleMaterials() {
  if (!isAdmin()) return;
  const M = [ // [料號, 品名, 規格, 分類, 單位, 每月用量, 其他名稱]
    ['RM-001', '不鏽鋼螺絲', 'M6×20 SUS304', '五金', '支', 3000, ''],
    ['RM-002', '不鏽鋼螺帽', 'M6 SUS304', '五金', '個', 2000, ''],
    ['RM-003', '紙箱', '60×40×40cm', '包裝材料', '個', 400, '五層紙箱'],
    ['RM-004', 'OPP 封箱膠帶', '48mm×100m 透明', '包裝材料', '捲', 60, '封箱膠帶'],
    ['RM-005', '棧板膜', '50cm×300m', '包裝材料', '捲', 1.5, '伸縮膜'],
    ['RM-006', '深溝滾珠軸承', '6204ZZ', '機械零件', '個', 8, '軸承'],
    ['RM-007', '三角皮帶', 'A-42', '機械零件', '條', 1, ''],
    ['RM-008', '工業酒精', '95% 4L', '耗材', '桶', 3, ''],
    ['RM-009', '工作手套', '600g', '耗材', '打', 25, '棉紗手套'],
    ['RM-010', 'PVC 電線', '2.0mm² 黑', '電子零件', '捲', 1, ''],
    ['RM-011', '鋁擠型', '30×30 6063', '原料', '支', 50, ''],
    ['RM-012', '矽利康', '透明 300ml', '耗材', '支', 40, ''],
    ['RM-013', '電阻', '1/4W 10kΩ', '電子零件', '顆', 500, ''],
  ];
  PBStore.saveMany('materials', M.map(([code, name, spec, category, unit, usage, alias], i) => ({ id: rid() + 'm' + i, code, name, spec, category, unit, usage, alias, note: '', sample: true, createdAt: nowIso(), updatedAt: nowIso() })));
  toast('範例原料清單已載入，都標有「範例」。');
}

/* ---------- 對話框 ---------- */
const dlg = $('#dlg');
function openDialog(html, mount) { S.detailId = null; S.dperson = null; dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); if (mount) mount(); const first = dlg.querySelector('[autofocus]'); if (first) first.focus(); }
function closeDialog() { if (dlg.open) dlg.close(); }
dlg.addEventListener('close', () => { S.detailId = null; S.dperson = null; dlg.innerHTML = ''; });
dlg.addEventListener('click', e => { if (e.target === dlg) closeDialog(); });
function openDetail(id) { S.detailId = id; dlg.innerHTML = detailHtml(id); if (!dlg.open) dlg.showModal(); }

function lifecycle(o) {
  const ap = o.approval, pg = o.progress;
  const steps = [{ l: '建單', d: stamp(o.createdAt), c: 'done' }];
  if (ap === 'approved') steps.push({ l: '核准', d: stamp(o.approvedAt), c: 'done' });
  else if (ap === 'rejected') steps.push({ l: '退回', d: '待修改', c: 'bad' });
  else steps.push({ l: '簽核', d: ap === 'l1' ? '主管簽核中' : ap === 'l2' ? '經理核准中' : '尚未送出', c: 'cur' });
  const ordered = ['ordered', 'partial', 'received'].includes(pg);
  steps.push(ordered ? { l: '叫貨', d: stamp(o.orderedAt), c: 'done' } : { l: '叫貨', d: ap === 'approved' ? '可以下單' : '核准後', c: ap === 'approved' ? 'cur' : '' });
  if (pg === 'received') steps.push({ l: '到貨', d: stamp(o.receivedAt), c: 'done' });
  else if (pg === 'partial') steps.push({ l: '到貨', d: `已到 ${qtyf(o.receivedQty)}/${qtyf(o.qty)}`, c: 'cur' });
  else steps.push({ l: '到貨', d: o.needBy ? '需求 ' + md(o.needBy) : '—', c: pg === 'ordered' ? 'cur' : '' });
  return steps.map(s => `<li class="${s.c}"><span class="s-l">${s.l}</span><span class="s-d">${esc(s.d || '—')}</span></li>`).join('');
}
function nextBlock(o) {
  const id = esc(o.id);
  const blk = (title, body, btns) => `<div class="next"><h3>${title}</h3>${body || ''}${btns ? `<div class="row">${btns}</div>` : ''}</div>`;
  const ord = can('order');
  if (o.progress === 'cancelled') return blk('此單已取消', '<p class="hint">已取消的單不會出現在看板上。</p>', ord ? `<button class="btn" type="button" data-act="restore" data-id="${id}">恢復此單</button>` : '');
  if (o.approval === 'draft') return blk('下一步：送出簽核', '<p class="hint">草稿還沒進入簽核。確認內容後送出，主管會在「簽核」頁看到。</p>', ord ? `<button class="btn primary" type="button" data-act="submit" data-id="${id}">送出簽核</button><button class="btn" type="button" data-act="edit" data-id="${id}">修改內容</button>` : '');
  if (o.approval === 'rejected') return blk('已退回，需要修改', `<p class="reason">退回原因：${esc(o.rejectNote || '未填寫')}</p>`, ord ? `<button class="btn" type="button" data-act="edit" data-id="${id}">修改內容</button><button class="btn primary" type="button" data-act="resubmit" data-id="${id}">重新送簽</button>` : '');
  if (o.approval === 'l1' || o.approval === 'l2') {
    const r = o.approval === 'l1' ? '主管' : '經理';
    if (!canApprove(o)) return blk(`等待${r}簽核`, `<p class="hint">你沒有${r}簽核的權限，等${r}處理即可。</p>`, '');
    return blk(`等待${r}簽核`, `<input id="dnote" class="inp" placeholder="簽核意見（退回時必填）" aria-label="簽核意見">`,
      `<button class="btn primary" type="button" data-act="approve" data-id="${id}" data-note="dnote">${r}核准</button><button class="btn danger" type="button" data-act="reject" data-id="${id}" data-note="dnote">退回</button>`);
  }
  if (!ord) return '';
  if (o.progress === 'todo') {
    const v = vById.get(o.vendorId);
    return blk('已核准，可以叫貨', `<p class="hint">向${esc(vendorName(o))}下單${v && v.phone ? `（電話 <span class="mono">${esc(v.phone)}</span>）` : ''}後，按「標記已叫貨」。</p>`, `<button class="btn primary" type="button" data-act="ordered" data-id="${id}">標記已叫貨</button>`);
  }
  if (o.progress === 'ordered' || o.progress === 'partial') {
    const left = Math.max(0, num(o.qty) - num(o.receivedQty));
    return blk('等待到貨', `<label class="f inline" for="drecv">本次到貨數量<input id="drecv" type="number" min="0" step="any" inputmode="decimal" placeholder="${qtyf(left)}"> <span class="hint">${esc(o.unit || '')}，尚欠 ${qtyf(left)}</span></label>`,
      `<button class="btn" type="button" data-act="receive" data-id="${id}">登記到貨</button><button class="btn primary" type="button" data-act="receive-all" data-id="${id}">全部到貨</button>`);
  }
  return blk(`已全部到貨 · ${md(isoDay(o.receivedAt))}`, '', `<button class="btn sm" type="button" data-act="unreceive" data-id="${id}" data-confirm="確定改回在途？">改回在途</button>`);
}
function histLi(h) {
  let t;
  switch (h.act) {
    case 'create': t = '建立叫貨單'; break;
    case 'submit': t = '送出簽核'; break;
    case 'resubmit': t = '修改後重新送簽'; break;
    case 'approve': t = (h.role || '') + '核准'; break;
    case 'reject': t = (h.role || '') + '退回'; break;
    case 'progress': t = '進度改為「' + (PROG_LABEL[h.to] || h.to) + '」' + (h.add ? `（本次到貨 ${qtyf(h.add)}）` : ''); break;
    case 'edit': t = '修改內容'; break;
    case 'cancel': t = '取消此單'; break;
    case 'restore': t = '恢復此單'; break;
    default: t = h.act || '';
  }
  return `<li><time>${esc(stamp(h.at))}</time><div><span>${esc(t)}</span>${h.by ? ` <span class="by">· ${esc(h.by)}</span>` : ''}${h.note ? `<div class="nt">「${esc(h.note)}」</div>` : ''}</div></li>`;
}
function detailHtml(id) {
  const o = PBStore.get('orders', id);
  if (!o) return `<div class="dlg"><div class="dlg-head"><div><h2>找不到這張叫貨單</h2><p class="hint">可能已經被刪除。</p></div><button type="button" class="icon-btn" data-close aria-label="關閉">×</button></div></div>`;
  const v = vById.get(o.vendorId), over = isOverdue(o), cancelled = o.progress === 'cancelled', oid = esc(o.id);
  const fact = (k, val) => `<div><dt>${k}</dt><dd>${val}</dd></div>`;
  return `<div class="dlg">
    <div class="dlg-head">
      <div>
        <div class="eyebrow"><span class="po">${esc(o.no)}</span>${sampleTag(o)}${cancelled ? '<span class="chip">已取消</span>' : chip(o)}</div>
        <h2>${esc(o.item)}${o.spec ? ` <span class="spec">${esc(o.spec)}</span>` : ''}</h2>
      </div>
      ${o.approval === 'approved' ? seal('核准', isoDay(o.approvedAt), 'lg') : o.approval === 'rejected' ? seal('退回', '', 'lg') : ''}
      <button type="button" class="icon-btn" data-close aria-label="關閉">×</button>
    </div>
    <div class="dlg-body">
      <ol class="stepper" aria-label="流程">${lifecycle(o)}</ol>
      ${nextBlock(o)}
      <dl class="facts">
        ${fact('數量', `<span class="num">${qtyf(o.qty)}</span> ${esc(o.unit || '')}`)}
        ${fact('單價', o.price ? `<span class="num">${price(o.price)}</span>` : '—')}
        ${fact('金額', `<span class="num">${money(o.amount)}</span>`)}
        ${fact('廠商', esc(vendorName(o)))}
        ${fact('廠商電話', v && v.phone ? `<span class="mono">${esc(v.phone)}</span>` : '—')}
        ${fact('申請人／部門', esc(o.requester || '—'))}
        ${fact('叫貨日期', o.date ? `${md(o.date)} ${wk(o.date)}` : '—')}
        ${fact('需求日期', o.needBy ? `<span class="${over ? 'bad-t' : ''}">${md(o.needBy)} ${wk(o.needBy)}${over ? ` · 逾期 ${daysBetween(o.needBy, today())} 天` : ''}</span>` : '—')}
        ${fact('已到貨', `<span class="num">${qtyf(o.receivedQty || 0)} / ${qtyf(o.qty)}</span> ${esc(o.unit || '')}`)}
        ${o.note ? `<div class="span-all"><dt>備註</dt><dd>${esc(o.note)}</dd></div>` : ''}
      </dl>
      <section><h3 class="sub-h">紀錄</h3><ol class="timeline">${(o.history || []).slice().reverse().map(histLi).join('')}</ol></section>
    </div>
    <div class="dlg-foot">
      ${can('order') ? `<div class="left">
        <button class="btn sm danger" type="button" data-act="delete" data-id="${oid}" data-confirm="確定刪除？無法復原">刪除</button>
        ${!cancelled && o.progress !== 'received' ? `<button class="btn sm" type="button" data-act="cancel" data-id="${oid}" data-confirm="確定取消此單？">取消此單</button>` : ''}
      </div><button class="btn" type="button" data-act="edit" data-id="${oid}">修改</button>` : ''}
      <button class="btn primary" type="button" data-close>完成</button>
    </div>
  </div>`;
}

/* ---------- 叫貨單表單 ---------- */
function nextNo(date) {
  const pre = 'PO' + String(date).replace(/-/g, '');
  let max = 0;
  for (const o of D.orders()) if ((o.no || '').startsWith(pre + '-')) max = Math.max(max, parseInt(o.no.slice(pre.length + 1), 10) || 0);
  return pre + '-' + String(max + 1).padStart(3, '0');
}
function openOrderForm(o, pre) {
  if (!can('order')) return toast('你沒有叫貨的權限。');
  pre = pre || {};
  const v = o || pre, isEdit = !!o;
  const names = [...new Set(D.products().map(p => p.name))].sort(cmpZh);
  const vs = [...D.vendors()].sort((a, b) => cmpZh(a.name, b.name));
  const date = (o && o.date) || pre.date || (S.view === 'orders' ? S.day : today());
  const reapprove = isEdit && o.progress === 'todo' && ['l1', 'l2', 'approved'].includes(o.approval);
  const canSubmit = !isEdit || ['draft', 'rejected'].includes(o.approval);
  const html = `<form id="orderForm" class="dlg" novalidate>
    <div class="dlg-head"><div><div class="eyebrow"><span class="po">${isEdit ? esc(o.no) : '新叫貨單'}</span></div><h2>${isEdit ? '修改叫貨單' : '新增叫貨'}</h2></div><button type="button" class="icon-btn" data-close aria-label="關閉">×</button></div>
    <div class="dlg-body form-grid">
      <label class="f span2" for="f-item"><span class="req">品名</span><input id="f-item" list="dl-products" autocomplete="off" value="${esc(v.item || '')}" placeholder="例如：不鏽鋼螺絲" ${isEdit ? '' : 'autofocus'}></label>
      <datalist id="dl-products">${names.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
      <div id="f-offers" class="offers span2"></div>
      <label class="f span2" for="f-spec">規格<input id="f-spec" value="${esc(v.spec || '')}" placeholder="尺寸、材質、型號"></label>
      <label class="f" for="f-qty"><span class="req">數量</span><input id="f-qty" type="number" min="0" step="any" inputmode="decimal" value="${esc(v.qty ?? '')}"></label>
      <label class="f" for="f-unit">單位<input id="f-unit" value="${esc(v.unit || '')}" placeholder="個、支、箱"></label>
      <label class="f span2" for="f-vendor">廠商<select id="f-vendor"><option value="">（未指定）</option>${vs.map(x => `<option value="${esc(x.id)}"${x.id === v.vendorId ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="f" for="f-price">單價（NT$）<input id="f-price" type="number" min="0" step="any" inputmode="decimal" value="${esc(v.price ?? '')}"></label>
      <div class="f">金額<output id="f-amount">NT$0</output></div>
      <label class="f" for="f-date">叫貨日期<input id="f-date" type="date" value="${esc(date)}"></label>
      <label class="f" for="f-need">需求日期<input id="f-need" type="date" value="${esc(v.needBy || '')}"></label>
      <label class="f span2" for="f-req">申請人／部門<input id="f-req" value="${esc(v.requester ?? myName())}" placeholder="例如：生產課 王小明"></label>
      <label class="f span2" for="f-note">備註<textarea id="f-note" rows="2">${esc(v.note || '')}</textarea></label>
      ${reapprove ? '<p class="hint span2">修改品名、規格、數量、單價或廠商後，會退回重新簽核。</p>' : ''}
      <p id="f-err" class="err span2" hidden></p>
    </div>
    <div class="dlg-foot">
      <button type="button" class="btn ghost" data-close>取消</button>
      ${isEdit ? `<button type="submit" class="btn${canSubmit ? '' : ' primary'}" value="save">儲存</button>` : '<button type="submit" class="btn" value="draft">存草稿</button>'}
      ${canSubmit ? `<button type="submit" class="btn primary" value="submit">${isEdit ? '儲存並送簽' : '送出簽核'}</button>` : ''}
    </div>
  </form>`;
  openDialog(html, () => mountOrderForm(o));
}
function mountOrderForm(o) {
  const item = $('#f-item'), vendor = $('#f-vendor'), priceI = $('#f-price'), qty = $('#f-qty'), unit = $('#f-unit'), spec = $('#f-spec');
  const upd2 = () => { $('#f-amount').textContent = money(num(qty.value) * num(priceI.value)); };
  const offers = () => {
    const name = item.value.trim();
    const list = D.products().filter(p => p.name === name).sort(offerSort), nq = list.filter(isQuote).length;
    $('#f-offers').innerHTML = list.length
      ? `<div class="offers-h">${new Set(list.map(p => p.vendorId)).size} 家廠商有這項產品，點一下帶入廠商、規格和單價：</div>` +
        list.map((p, i) => `<button type="button" class="offer${vendor.value === p.vendorId && (spec.value || '') === (p.spec || '') ? ' on' : ''}" data-pick="${esc(p.id)}"><b>${esc(vName(p.vendorId))}</b><span>${esc(p.spec || '')}</span><span class="num">${esc(priceText(p))}</span>${i === 0 && isQuote(p) && nq > 1 ? '<em>最低</em>' : ''}</button>`).join('')
      : (name && D.products().length ? '<div class="offers-h">目前沒有廠商登錄這項產品，可以直接填寫。</div>' : '');
  };
  item.addEventListener('input', offers);
  spec.addEventListener('input', offers);
  vendor.addEventListener('change', () => {
    const p = D.products().find(x => x.name === item.value.trim() && x.vendorId === vendor.value);
    if (p) { priceI.value = num(p.price) > 0 ? p.price : ''; if (!unit.value) unit.value = p.unit || ''; if (!spec.value) spec.value = p.spec || ''; upd2(); }
    offers();
  });
  qty.addEventListener('input', upd2); priceI.addEventListener('input', upd2);
  $('#f-offers').addEventListener('click', e => {
    const b = e.target.closest('[data-pick]'); if (!b) return;
    const p = PBStore.get('products', b.dataset.pick); if (!p) return;
    vendor.value = p.vendorId; priceI.value = num(p.price) > 0 ? p.price : ''; unit.value = p.unit || ''; spec.value = p.spec || '';
    if (!qty.value && p.moq) qty.value = p.moq;
    if (!$('#f-need').value && p.leadDays) $('#f-need').value = addDays($('#f-date').value || today(), num(p.leadDays));
    upd2(); offers();
  });
  offers(); upd2();
  $('#orderForm').addEventListener('submit', e => { e.preventDefault(); saveOrder(o, (e.submitter && e.submitter.value) || 'save'); });
}
function saveOrder(o, mode) {
  const g = id => $('#' + id).value.trim();
  const err = $('#f-err');
  const fail = (msg, id) => { err.textContent = msg; err.hidden = false; if (id) $('#' + id).focus(); };
  const item = g('f-item'), qty = num(g('f-qty'));
  if (!item) return fail('請填寫品名。', 'f-item');
  if (!(qty > 0)) return fail('數量要大於 0。', 'f-qty');
  const vendorId = g('f-vendor'), v = vById.get(vendorId), p = num(g('f-price'));
  const t = nowIso(), me = myName();
  const data = {
    item, spec: g('f-spec'), qty, unit: g('f-unit'), vendorId, vendorName: v ? v.name : '',
    price: p, amount: Math.round(qty * p * 100) / 100, date: g('f-date') || S.day, needBy: g('f-need'),
    requester: g('f-req'), note: g('f-note'), updatedAt: t,
  };
  if (!o) {
    const submit = mode === 'submit';
    const doc = {
      id: rid(), ...data, no: nextNo(data.date), progress: 'todo', approval: submit ? 'l1' : 'draft', receivedQty: 0,
      createdBy: me, createdAt: t, submittedAt: submit ? t : null, approvedAt: null, orderedAt: null, receivedAt: null, rejectNote: '',
      history: [{ id: rid(), act: 'create', by: me, at: t }].concat(submit ? [{ id: rid(), act: 'submit', by: me, at: t, role: '申請人' }] : []),
    };
    closeDialog();
    if (S.view === 'orders' && !S.flag && S.scope === 'day' && data.date !== S.day) S.day = data.date;
    PBStore.save('orders', doc);
    toast(submit ? `${doc.no} 已送出簽核` : `${doc.no} 已存成草稿`);
    return;
  }
  const cur = PBStore.get('orders', o.id) || o;
  const keyChanged = ['item', 'spec', 'qty', 'price', 'vendorId'].some(k => String(cur[k] ?? '') !== String(data[k] ?? ''));
  const patch = { ...data };
  const hist = histAdd(cur, { act: 'edit' });
  let msg = `${cur.no} 已更新`;
  if (keyChanged && cur.progress === 'todo' && ['l1', 'l2', 'approved'].includes(cur.approval)) {
    Object.assign(patch, { approval: 'l1', approvedAt: null, submittedAt: t });
    hist.push({ id: rid(), act: 'resubmit', by: me, at: t, role: '申請人' }); msg += '，已重新送簽';
  }
  if (mode === 'submit' && ['draft', 'rejected'].includes(cur.approval)) {
    Object.assign(patch, { approval: 'l1', submittedAt: t, rejectNote: '' });
    hist.push({ id: rid(), act: cur.approval === 'rejected' ? 'resubmit' : 'submit', by: me, at: t, role: '申請人' }); msg = `${cur.no} 已送出簽核`;
  }
  patch.history = hist;
  upd('orders', cur.id, patch, msg);
  openDetail(cur.id);
}

/* ---------- 叫貨單動作 ---------- */
function noteVal(t) { const el = t.dataset.note && document.getElementById(t.dataset.note); return el ? el.value.trim() : ''; }
function orderAct(act, o, t) {
  if (!o) return toast('找不到這張叫貨單，可能已被別人刪除。');
  const id = o.id, t0 = nowIso();
  const needOrder = () => { if (!can('order')) { toast('你沒有叫貨的權限。'); return false; } return true; };
  switch (act) {
    case 'submit':
    case 'resubmit':
      if (!needOrder()) return;
      return upd('orders', id, { approval: 'l1', submittedAt: t0, rejectNote: '', updatedAt: t0, history: histAdd(o, { act: o.approval === 'rejected' ? 'resubmit' : 'submit', role: '申請人' }) }, `${o.no} 已送出簽核`);
    case 'approve': {
      if (!canApprove(o)) return toast('你沒有這一關的簽核權限。');
      const note = noteVal(t), final = o.approval === 'l2';
      const patch = { approval: final ? 'approved' : 'l2', updatedAt: t0, history: histAdd(o, { act: 'approve', role: final ? '經理' : '主管', note }) };
      if (final) patch.approvedAt = t0;
      return upd('orders', id, patch, final ? `${o.no} 已核准，可以叫貨了` : `${o.no} 主管已核准，轉給經理`);
    }
    case 'reject': {
      if (!canApprove(o)) return toast('你沒有這一關的簽核權限。');
      const note = noteVal(t);
      if (!note) { const el = document.getElementById(t.dataset.note); if (el) el.focus(); return toast('請填寫退回原因，讓申請人知道要改什麼。'); }
      return upd('orders', id, { approval: 'rejected', rejectNote: note, updatedAt: t0, history: histAdd(o, { act: 'reject', role: o.approval === 'l1' ? '主管' : '經理', note }) }, `${o.no} 已退回`);
    }
    case 'ordered':
      if (!needOrder()) return;
      if (o.approval !== 'approved') return toast('這張單還沒核准，核准後才能叫貨。');
      return upd('orders', id, { progress: 'ordered', orderedAt: o.orderedAt || t0, updatedAt: t0, history: histAdd(o, { act: 'progress', to: 'ordered' }) }, `${o.no} 已標記叫貨`);
    case 'receive-all':
      if (!needOrder()) return;
      return upd('orders', id, { progress: 'received', receivedQty: num(o.qty), receivedAt: t0, updatedAt: t0, history: histAdd(o, { act: 'progress', to: 'received' }) }, `${o.no} 已全部到貨`);
    case 'receive': {
      if (!needOrder()) return;
      const el = $('#drecv'), add = num(el && el.value);
      if (!(add > 0)) { if (el) el.focus(); return toast('請輸入這次到貨的數量。'); }
      const got = num(o.receivedQty) + add, done = got >= num(o.qty);
      return upd('orders', id, { progress: done ? 'received' : 'partial', receivedQty: got, receivedAt: done ? t0 : null, updatedAt: t0, history: histAdd(o, { act: 'progress', to: done ? 'received' : 'partial', add }) },
        done ? `${o.no} 已全部到貨` : `${o.no} 已登記到貨 ${qtyf(add)}，尚欠 ${qtyf(num(o.qty) - got)}`);
    }
    case 'unreceive':
      if (!needOrder()) return;
      return upd('orders', id, { progress: 'ordered', receivedQty: 0, receivedAt: null, updatedAt: t0, history: histAdd(o, { act: 'progress', to: 'ordered' }) }, `${o.no} 已改回在途`);
    case 'cancel':
      if (!needOrder()) return;
      return upd('orders', id, { progress: 'cancelled', prevProgress: o.progress, updatedAt: t0, history: histAdd(o, { act: 'cancel' }) }, `${o.no} 已取消`);
    case 'restore':
      if (!needOrder()) return;
      return upd('orders', id, { progress: o.prevProgress || 'todo', updatedAt: t0, history: histAdd(o, { act: 'restore' }) }, `${o.no} 已恢復`);
    case 'edit':
      return openOrderForm(o);
    case 'delete':
      if (!needOrder()) return;
      closeDialog();
      PBStore.remove('orders', id);
      return toast(`${o.no} 已刪除`);
  }
}

/* ---------- 廠商、產品表單 ---------- */
function openVendorForm(v) {
  if (!can('vendor')) return toast('你沒有維護廠商資料的權限。');
  v = v || {};
  const isEdit = !!v.id;
  const pc = isEdit ? D.products().filter(p => p.vendorId === v.id).length : 0;
  openDialog(`<form id="vendorForm" class="dlg" novalidate>
    <div class="dlg-head"><div><h2>${isEdit ? '編輯廠商' : '新增廠商'}</h2></div><button type="button" class="icon-btn" data-close aria-label="關閉">×</button></div>
    <div class="dlg-body form-grid">
      <label class="f" for="v-code">廠商代號<input id="v-code" maxlength="20" value="${esc(v.code || '')}" placeholder="例如：A001"></label>
      <label class="f" for="v-name"><span class="req">廠商名稱</span><input id="v-name" value="${esc(v.name || '')}" autofocus></label>
      <label class="f" for="v-cat">主要品類<input id="v-cat" value="${esc(v.category || '')}" placeholder="五金、包材、電子零件"></label>
      <label class="f" for="v-contact">聯絡人<input id="v-contact" value="${esc(v.contact || '')}"></label>
      <label class="f" for="v-phone">電話<input id="v-phone" type="tel" value="${esc(v.phone || '')}"></label>
      <label class="f" for="v-email">Email<input id="v-email" type="email" value="${esc(v.email || '')}"></label>
      <label class="f" for="v-terms">付款條件<input id="v-terms" value="${esc(v.terms || '')}" placeholder="月結 30 天"></label>
      <label class="f" for="v-lead">平均交期（天）<input id="v-lead" type="number" min="0" step="1" value="${esc(v.leadDays || '')}"></label>
      <label class="f span2" for="v-url">型錄／官網網址<input id="v-url" type="url" inputmode="url" value="${esc(v.url || '')}" placeholder="https://"></label>
      <label class="f span2" for="v-note">備註<textarea id="v-note" rows="2">${esc(v.note || '')}</textarea></label>
      <p id="v-err" class="err span2" hidden></p>
    </div>
    <div class="dlg-foot">
      ${isEdit ? `<div class="left"><button class="btn sm danger" type="button" data-act="delete-vendor" data-id="${esc(v.id)}" data-confirm="${pc ? `連同 ${pc} 項產品一起刪除？` : '確定刪除？'}">刪除廠商</button></div>` : ''}
      <button type="button" class="btn ghost" data-close>取消</button>
      <button type="submit" class="btn primary">儲存</button>
    </div></form>`, () => {
    $('#vendorForm').addEventListener('submit', e => {
      e.preventDefault();
      const g = id => $('#' + id).value.trim();
      const name = g('v-name'), code = g('v-code'), url = g('v-url'), err = $('#v-err');
      const fail = (m, id) => { err.textContent = m; err.hidden = false; if (id) $('#' + id).focus(); };
      if (!name) return fail('請填寫廠商名稱。', 'v-name');
      if (D.vendors().some(x => x.id !== v.id && x.name.trim() === name && (!code || !x.code || x.code === code))) return fail('已經有同名的廠商。');
      if (code && D.vendors().some(x => x.id !== v.id && normKey(x.code) === normKey(code))) return fail('已經有相同代號的廠商。', 'v-code');
      if (url && !okUrl(url)) return fail('網址要以 http:// 或 https:// 開頭。', 'v-url');
      const data = { code, name, category: g('v-cat'), contact: g('v-contact'), phone: g('v-phone'), email: g('v-email'), terms: g('v-terms'), leadDays: num(g('v-lead')), url, note: g('v-note'), updatedAt: nowIso() };
      closeDialog();
      if (isEdit) upd('vendors', v.id, data, `已更新 ${name}`);
      else { const id = rid(); S.pvendor = id; PBStore.save('vendors', { id, ...data, createdAt: nowIso() }); toast(`已新增 ${name}`); }
    });
  });
}
function openProductForm(p) {
  if (!can('vendor')) return toast('你沒有維護產品資料的權限。');
  p = p || {};
  const isEdit = !!p.id;
  const vs = [...D.vendors()].sort(vendorSort);
  if (!vs.length) { toast('請先新增廠商，再登錄產品。'); return openVendorForm(); }
  const vid = p.vendorId || S.pvendor || '';
  const cats = [...new Set(D.products().map(x => x.category).filter(Boolean))].sort(cmpZh);
  const opt = (val, label, cur) => `<option value="${val}"${(cur || '') === val ? ' selected' : ''}>${label}</option>`;
  openDialog(`<form id="productForm" class="dlg" novalidate>
    <div class="dlg-head"><div><h2>${isEdit ? '編輯產品' : '新增產品'}</h2></div><button type="button" class="icon-btn" data-close aria-label="關閉">×</button></div>
    <div class="dlg-body form-grid">
      <label class="f span2" for="p-vendor"><span class="req">廠商</span><select id="p-vendor"><option value="">請選擇</option>${vs.map(v => `<option value="${esc(v.id)}"${v.id === vid ? ' selected' : ''}>${esc(vLabel(v))}</option>`).join('')}</select></label>
      <label class="f span2" for="p-name"><span class="req">品名</span><input id="p-name" value="${esc(p.name || '')}" list="dl-pnames" autocomplete="off" autofocus></label>
      <datalist id="dl-pnames">${[...new Set(D.products().map(x => x.name))].sort(cmpZh).map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
      <label class="f span2" for="p-spec">規格<input id="p-spec" value="${esc(p.spec || '')}"></label>
      <label class="f" for="p-cat">分類<input id="p-cat" value="${esc(p.category || '')}" list="dl-cats" autocomplete="off"></label>
      <datalist id="dl-cats">${cats.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      <label class="f" for="p-unit">單位<input id="p-unit" value="${esc(p.unit || '')}"></label>
      <label class="f" for="p-price">單價（NT$，沒有就空白）<input id="p-price" type="number" min="0" step="any" inputmode="decimal" value="${num(p.price) > 0 ? esc(p.price) : ''}"></label>
      <label class="f" for="p-ptype">價格類型<select id="p-ptype">${opt('', '採購報價', p.priceType)}${opt('retail', '公開零售價／菜單價', p.priceType)}</select></label>
      <label class="f" for="p-moq">最小訂量<input id="p-moq" type="number" min="0" step="any" value="${esc(p.moq || '')}"></label>
      <label class="f" for="p-lead">交期（天）<input id="p-lead" type="number" min="0" step="1" value="${esc(p.leadDays || '')}"></label>
      <label class="f" for="p-level">資料層級<select id="p-level">${opt('', '單一品項', p.level)}${opt('cat', '品類（不是單一品項）', p.level)}${opt('menu', '菜單品項', p.level)}</select></label>
      <span class="f"></span>
      <label class="f span2" for="p-url">來源網址（型錄、官網商品頁）<input id="p-url" type="url" inputmode="url" value="${esc(p.url || '')}" placeholder="https://"></label>
      <label class="f span2" for="p-note">備註<textarea id="p-note" rows="2">${esc(p.note || '')}</textarea></label>
      <p id="p-err" class="err span2" hidden></p>
    </div>
    <div class="dlg-foot">
      ${isEdit ? `<div class="left"><button class="btn sm danger" type="button" data-act="delete-product" data-id="${esc(p.id)}" data-confirm="確定刪除？">刪除產品</button></div>` : ''}
      <button type="button" class="btn ghost" data-close>取消</button>
      <button type="submit" class="btn primary">儲存</button>
    </div></form>`, () => {
    $('#productForm').addEventListener('submit', e => {
      e.preventDefault();
      const g = id => $('#' + id).value.trim();
      const err = $('#p-err'), vendorId = g('p-vendor'), name = g('p-name'), url = g('p-url');
      if (!vendorId) { err.textContent = '請選擇廠商。'; err.hidden = false; return $('#p-vendor').focus(); }
      if (!name) { err.textContent = '請填寫品名。'; err.hidden = false; return $('#p-name').focus(); }
      if (url && !okUrl(url)) { err.textContent = '網址要以 http:// 或 https:// 開頭。'; err.hidden = false; return $('#p-url').focus(); }
      const data = { vendorId, name, spec: g('p-spec'), category: g('p-cat'), unit: g('p-unit'), price: num(g('p-price')), priceType: g('p-ptype'), moq: num(g('p-moq')), leadDays: num(g('p-lead')), level: g('p-level'), url, note: g('p-note'), updatedAt: nowIso() };
      closeDialog();
      if (isEdit) upd('products', p.id, data, `已更新 ${name}`);
      else { PBStore.save('products', { id: rid(), ...data }); toast(`已新增 ${name}`); }
    });
  });
}

/* 從 Excel 貼上匯入：有標題列時依標題對欄位（可以貼「廠商名錄」或「產品／報價」表），沒有標題時照固定順序 */
const IMP_COLS = {
  code: ['廠商代號', '代號', '廠商編號', '供應商代號'],
  vendor: ['廠商名稱', '廠商', '供應商', '供應商名稱'],
  name: ['品名', '商品或服務名稱', '產品名稱', '商品名稱', '產品', '商品'],
  spec: ['規格', '產品規格'],
  category: ['分類', '分類／MENU範圍', '品類', '原始分類', '產品分類'],
  unit: ['單位'],
  price: ['單價', '單價(元)', '單價（元）', '公開售價起（元）', '公開售價起(元)', '售價', '價格'],
  moq: ['最小訂量', 'MOQ', '最低訂購量'],
  leadDays: ['交期(天)', '交期（天）', '交期'],
  level: ['資料層級'],
  priceText: ['價格或規格文字'],
  url: ['商品／MENU來源網址', '主要菜單或型錄來源', '型錄網址', '官網', '網址', '來源網址', '公開網址（可複製開啟）'],
  note: ['備註', '確認事項／備註'],
  status: ['公開資訊狀態'],
  srcType: ['來源類型', '資料來源類型'],
  contact: ['聯絡人', '聯絡窗口'],
  phone: ['電話', '聯絡電話'],
  email: ['Email', 'E-mail', '電子郵件'],
  terms: ['付款條件'],
};
const normH = s => String(s ?? '').replace(/[\s　]/g, '').toLowerCase();
const IMP_INDEX = new Map(Object.entries(IMP_COLS).flatMap(([k, names]) => names.map(n => [normH(n), k])));
// 解析 Excel 複製出來的表格（Tab 分隔；儲存格內有換行時 Excel 會加引號）
function parseDelimited(text) {
  const delim = text.includes('\t') ? '\t' : ',', rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += c; }
    else if (c === '"' && cell === '') inQ = true;
    else if (c === delim) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter(r => r.some(c => c));
}
function parseImport(text) {
  const all = parseDelimited(text);
  let hi = -1, map = null;
  for (let i = 0; i < Math.min(all.length, 15); i++) {
    const m = {}; let hits = 0;
    all[i].forEach((c, j) => { const k = IMP_INDEX.get(normH(c)); if (k && !(k in m)) { m[k] = j; hits++; } });
    if (hits >= 2 && ('vendor' in m || 'code' in m)) { hi = i; map = m; break; }
  }
  if (hi < 0) {
    const rows = all.slice();
    if (rows.length && /廠商|供應商|vendor/i.test(rows[0][0] || '')) rows.shift();
    return { mode: 'products', header: false, skipped: [], rows: rows.map(r => ({ code: '', vendor: r[0] || '', name: r[1] || '', spec: r[2] || '', category: r[3] || '', unit: r[4] || '', price: num(r[5]), moq: num(r[6]), leadDays: num(r[7]) })).filter(r => r.vendor && r.name) };
  }
  const get = (r, k) => k in map ? String(r[map[k]] ?? '').trim() : '';
  const body = all.slice(hi + 1);
  if ('name' in map) {
    const rows = body.map(r => {
      const lv = get(r, 'level');
      const level = /品類/.test(lv) ? 'cat' : /菜單/.test(lv) ? 'menu' : '';
      return {
        code: get(r, 'code'), vendor: get(r, 'vendor'), name: get(r, 'name'), spec: get(r, 'spec'), category: get(r, 'category'), unit: get(r, 'unit'),
        price: num(get(r, 'price')), moq: num(get(r, 'moq')), leadDays: num(get(r, 'leadDays')), url: get(r, 'url'),
        level, priceType: /實際商品|菜單|零售/.test(lv) ? 'retail' : '', note: [level === 'cat' ? '' : lv, get(r, 'priceText'), get(r, 'note')].filter(Boolean).join('｜'),
      };
    }).filter(r => (r.vendor || r.code) && r.name);
    return { mode: 'products', header: true, skipped: [], rows, byCat: !('spec' in map) };
  }
  const skipped = [], rows = [];
  for (const r of body) {
    const x = { code: get(r, 'code'), name: get(r, 'vendor'), category: get(r, 'category'), url: get(r, 'url'), contact: get(r, 'contact'), phone: get(r, 'phone'), email: get(r, 'email'), terms: get(r, 'terms'),
      note: [get(r, 'status'), get(r, 'srcType'), get(r, 'note')].filter(Boolean).join('｜') };
    if (!x.name && !x.code) continue;
    if (/非廠商/.test(get(r, 'status'))) { skipped.push(x.name || x.code); continue; }
    rows.push(x);
  }
  return { mode: 'vendors', header: true, skipped, rows };
}
// 廠商比對：有代號用代號，沒有就用名稱（名稱相同但代號不同的視為不同廠商）
function vendorMatcher() {
  const byCode = new Map(), byName = new Map();
  const add = v => { if (v.code) byCode.set(normKey(v.code), v); if (v.name) byName.set(v.name.trim(), v); };
  D.vendors().forEach(add);
  const find = (code, name) => {
    const c = code && byCode.get(normKey(code)); if (c) return c;
    const n = name && byName.get(name.trim());
    return n && (!code || !n.code || normKey(n.code) === normKey(code)) ? n : null;
  };
  return { find, add };
}
function importSummary(parsed) {
  const { mode, rows, skipped } = parsed, vm = vendorMatcher(), fresh = new Set();
  for (const r of rows) {
    const name = mode === 'vendors' ? r.name : r.vendor;
    if (!vm.find(r.code, name)) { const k = r.code ? 'c:' + normKey(r.code) : 'n:' + name.trim(); fresh.add(k); vm.add({ code: r.code, name }); }
  }
  if (mode === 'vendors') return `讀到 ${rows.length} 家廠商資料：會新增 ${fresh.size} 家、更新 ${rows.length - fresh.size} 家${skipped.length ? `；略過 ${skipped.length} 筆標示為非廠商的費用類別（${skipped.slice(0, 5).join('、')}${skipped.length > 5 ? ' 等' : ''}）` : ''}。`;
  const cat = rows.filter(r => r.level === 'cat').length, retail = rows.filter(r => r.priceType === 'retail').length;
  return `讀到 ${rows.length} 項產品${cat || retail ? `（品類 ${cat}、公開零售價／菜單 ${retail}、其他 ${rows.length - cat - retail}）` : ''}${fresh.size ? `，會新增 ${fresh.size} 家廠商` : ''}。`;
}
function openImport() {
  if (!can('vendor')) return toast('你沒有維護產品資料的權限。');
  openDialog(`<div class="dlg">
    <div class="dlg-head"><div><h2>從 Excel 貼上匯入</h2><p class="hint">在 Excel 選取表格範圍（連同標題列）、複製，貼到下面。會依標題自動對應欄位，可以貼「廠商名錄」或「產品／報價」表。</p></div><button type="button" class="icon-btn" data-close aria-label="關閉">×</button></div>
    <div class="dlg-body">
      <div class="imp-cols">產品表常用標題：廠商代號、廠商、品名、規格、分類、單位、單價、最小訂量、交期、資料層級、備註</div>
      <div class="imp-cols">廠商名錄常用標題：廠商代號、廠商名稱、分類、聯絡人、電話、Email、付款條件、網址、備註</div>
      <div class="imp-cols">沒有標題列時照這個順序：廠商 ⇥ 品名 ⇥ 規格 ⇥ 分類 ⇥ 單位 ⇥ 單價 ⇥ 最小訂量 ⇥ 交期(天)</div>
      <textarea id="imp-text" class="imp-text" placeholder="大成五金行	不鏽鋼螺絲	M6×20 SUS304	五金	支	2.5	500	2" aria-label="貼上表格內容"></textarea>
      <p id="imp-sum" class="hint">還沒有內容。</p>
      <p class="hint">有廠商代號時用代號比對廠商，否則用名稱；名錄裡沒有的廠商會自動建立。同一家廠商、同品名、同規格的產品會更新，不會重複新增。資料層級是「官網實際商品」「餐廳菜單品名」的會標成公開零售價，「商品／服務品類」會標成品類。</p>
    </div>
    <div class="dlg-foot"><button type="button" class="btn ghost" data-close>取消</button><button type="button" class="btn primary" id="imp-go" disabled>匯入</button></div>
  </div>`, () => {
    const ta = $('#imp-text'), sum = $('#imp-sum'), go = $('#imp-go');
    let parsed = null;
    ta.addEventListener('input', () => {
      parsed = parseImport(ta.value);
      sum.textContent = parsed.rows.length ? importSummary(parsed) : (ta.value.trim() ? '讀不到資料：每一列至少要有「廠商」和「品名」，或貼上含「廠商名稱／廠商代號」標題的廠商名錄。' : '還沒有內容。');
      go.disabled = !parsed.rows.length;
    });
    go.addEventListener('click', () => { if (parsed) runImport(parsed); });
    ta.focus();
  });
}
function runImport(parsed) {
  const { mode, rows, header } = parsed;
  if (!rows.length) return;
  const T = nowIso(), vm = vendorMatcher(), vOut = new Map(), touched = new Set();
  let addedV = 0;
  const setNonEmpty = (obj, fields) => { for (const [k, val] of Object.entries(fields)) if (val !== '' && val != null && !(typeof val === 'number' && !val)) obj[k] = val; };
  const upsertV = (code, name, fields) => {
    const found = vm.find(code, name);
    if (found) {
      const cur = vOut.get(found.id) || { ...found };
      setNonEmpty(cur, { code, ...fields }); cur.updatedAt = T;
      if (!cur._new) touched.add(found.id);
      vOut.set(found.id, cur); vm.add(cur); return cur;
    }
    const nv = { id: rid(), code: code || '', name: name || code, category: '', contact: '', phone: '', email: '', terms: '', leadDays: 0, url: '', note: '', createdAt: T, updatedAt: T, _new: true };
    setNonEmpty(nv, fields); addedV++;
    vOut.set(nv.id, nv); vm.add(nv); return nv;
  };
  let addedP = 0, updatedP = 0;
  const pOut = new Map();
  if (mode === 'vendors') {
    for (const r of rows) upsertV(r.code, r.name, { name: r.name, category: r.category, url: okUrl(r.url) ? r.url : '', note: r.note, contact: r.contact, phone: r.phone, email: r.email, terms: r.terms });
  } else {
    const pkey = (vid, name, spec, cat) => vid + '|' + name.trim() + '|' + (spec || '').trim() + (parsed.byCat ? '|' + (cat || '').trim() : '');
    const existing = new Map(D.products().map(p => [pkey(p.vendorId, p.name || '', p.spec, p.category), p]));
    for (const r of rows) {
      const v = vm.find(r.code, r.vendor) || upsertV(r.code, r.vendor, { name: r.vendor, category: r.category, leadDays: r.leadDays });
      const key = pkey(v.id, r.name, r.spec, r.category);
      const body = { vendorId: v.id, name: r.name, spec: r.spec, category: r.category, unit: r.unit, price: r.price, moq: r.moq, leadDays: r.leadDays, updatedAt: T };
      if (header) Object.assign(body, { level: r.level || '', priceType: r.priceType || '', url: okUrl(r.url) ? r.url : '', ...(r.note ? { note: r.note } : {}) });
      const prev = pOut.get(key);
      if (prev) { Object.assign(prev, body); continue; }
      const ex = existing.get(key);
      if (ex) { updatedP++; pOut.set(key, { ...ex, ...body }); }
      else { addedP++; pOut.set(key, { id: rid(), note: '', ...body }); }
    }
  }
  const vRecs = [...vOut.values()].map(v => { const { _new, ...rest } = v; return rest; });
  if (vRecs.length) PBStore.saveMany('vendors', vRecs);
  if (pOut.size) PBStore.saveMany('products', [...pOut.values()]);
  closeDialog();
  toast(mode === 'vendors'
    ? `匯入完成：新增 ${addedV} 家、更新 ${touched.size} 家廠商${parsed.skipped.length ? `，略過 ${parsed.skipped.length} 筆非廠商` : ''}。`
    : `匯入完成：新增 ${addedP} 項、更新 ${updatedP} 項產品${addedV ? `，新增 ${addedV} 家廠商` : ''}。`);
  S.pq = ''; $('#pq').value = ''; S.pvendor = ''; S.pcat = ''; S.vmode = 'products';
  if (S.view !== 'vendors') location.hash = 'vendors'; else render();
}

/* ---------- 人員與權限（管理員）---------- */
const U = { list: null, admins: [], loading: false, error: '' };
async function loadUsers() {
  if (!isAdmin() || U.loading) return;
  U.loading = true; renderUsers();
  try { const j = await PBAuth.api('users'); U.list = j.users || []; U.admins = j.admins || []; U.error = ''; }
  catch (e) { U.error = e.message; }
  U.loading = false; renderUsers();
}
function renderUsers() {
  const root = $('#userList');
  if (!root || S.view !== 'users') return;
  if (!U.list) { root.innerHTML = U.error ? `<div class="banner bad">讀不到人員名單：${esc(U.error)}<button class="btn sm" type="button" data-reload-users>重試</button></div>` : loadingBox('人員名單'); return; }
  const fmt = ms => ms ? stamp(new Date(ms).toISOString()) : '還沒登入過';
  const admins = U.admins.map(a => `<div class="urow"><div class="urow-main"><b>${esc(a)}</b><div class="row"><span class="chip perm">管理員：全部權限</span></div></div><span class="hint">要更換管理員，請改雲端後端 Code.gs 的 ADMIN_EMAILS_</span></div>`).join('');
  const rows = U.list.map(u => `<div class="urow">
    <div class="urow-main">
      <b>${esc(u.name || u.email)}</b><span class="hint">${esc(u.email)} · 最後登入 ${esc(fmt(u.lastLogin))}</span>
      <div class="row">${u.enabled ? '' : '<span class="chip off">已停用</span>'}${(u.pages || []).map(p => `<span class="chip perm">${esc(PERM_LABEL[p] || p)}</span>`).join('') || '<span class="chip">只能查看</span>'}</div>
    </div>
    <div class="row">
      <button class="btn sm" type="button" data-edit-user="${esc(u.email)}">編輯</button>
      <button class="btn sm" type="button" data-toggle-user="${esc(u.email)}">${u.enabled ? '停用' : '啟用'}</button>
      <button class="btn sm danger" type="button" data-del-user="${esc(u.email)}" data-confirm="確定刪除？">刪除</button>
    </div>
  </div>`).join('');
  root.innerHTML = `<div class="ulist">${admins}${rows}</div>${U.list.length ? '' : '<p class="hint">還沒有加入任何同事。按「＋ 新增人員」，輸入同事的 Gmail 並勾選權限。</p>'}${U.loading ? '<p class="hint">更新中…</p>' : ''}`;
}
function openUserForm(u) {
  const isEdit = !!u;
  u = u || { email: '', name: '', pages: ['order'], enabled: true };
  openDialog(`<form id="userForm" class="dlg" novalidate>
    <div class="dlg-head"><div><h2>${isEdit ? '編輯人員' : '新增人員'}</h2><p class="hint">同事用這個 Gmail 登入後，就能看到全部資料；下面勾選的是他能做的事。</p></div><button type="button" class="icon-btn" data-close aria-label="關閉">×</button></div>
    <div class="dlg-body form-grid">
      <label class="f span2" for="u-email"><span class="req">Gmail</span><input id="u-email" type="email" value="${esc(u.email)}" ${isEdit ? 'readonly' : 'autofocus'} placeholder="name@gmail.com"></label>
      <label class="f span2" for="u-name">姓名（顯示在簽核紀錄）<input id="u-name" value="${esc(u.name)}" placeholder="例如：王小明"></label>
      <div class="f span2">權限<div class="perm-list">${PERMS.map(p => `<label class="perm" for="u-p-${p.id}"><input type="checkbox" id="u-p-${p.id}" value="${p.id}"${(u.pages || []).includes(p.id) ? ' checked' : ''}><span><b>${p.label}</b><span>${p.desc}</span></span></label>`).join('')}</div></div>
      <p id="u-err" class="err span2" hidden></p>
    </div>
    <div class="dlg-foot"><button type="button" class="btn ghost" data-close>取消</button><button type="submit" class="btn primary" id="u-save">儲存</button></div>
  </form>`, () => {
    $('#userForm').addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('#u-email').value.trim(), err = $('#u-err');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = '請輸入正確的 Gmail 地址。'; err.hidden = false; return; }
      const pages = PERMS.filter(p => $('#u-p-' + p.id).checked).map(p => p.id);
      $('#u-save').disabled = true;
      try {
        const j = await PBAuth.api('userSave', { email, name: $('#u-name').value.trim(), pages, enabled: u.enabled !== false });
        U.list = j.users || U.list; closeDialog(); renderUsers(); toast(isEdit ? '已更新' : `已加入 ${email}，請他用這個 Gmail 登入`);
      } catch (x) { err.textContent = x.message; err.hidden = false; $('#u-save').disabled = false; }
    });
  });
}
async function userCall(action, payload, okMsg) {
  try { const j = await PBAuth.api(action, payload); U.list = j.users || U.list; renderUsers(); toast(okMsg); }
  catch (e) { toast(e.message); }
}

/* ---------- 範例資料（管理員） ---------- */
function loadSample() {
  if (!isAdmin() || S.busy) return;
  const T = today();
  const V = [
    ['v1', '大成五金行', '五金', '業務 林先生', '04-2300-0101', '月結 30 天', 2],
    ['v2', '全友機械零件', '機械零件', '業務 陳小姐', '04-2400-0202', '月結 60 天', 5],
    ['v3', '永豐包裝材料', '包裝材料', '黃經理', '02-2200-0303', '月結 30 天', 3],
    ['v4', '協和電子材料', '電子零件', '業務 張先生', '03-500-0404', '貨到付款', 7],
    ['v5', '宏昌工業用品', '耗材', '業務 吳小姐', '06-200-0505', '月結 30 天', 2],
    ['v6', '順發辦公文具', '辦公用品', '門市 李先生', '02-2700-0606', '現金', 1],
  ];
  const P = [
    ['v1', '不鏽鋼螺絲', 'M6×20 SUS304', '五金', '支', 2.5, 500, 2], ['v1', '不鏽鋼螺帽', 'M6 SUS304', '五金', '個', 1.2, 500, 2],
    ['v1', '平華司', 'M6 鍍鋅', '五金', '個', 0.6, 1000, 2], ['v1', '棉紗手套', '600g', '耗材', '打', 85, 10, 2],
    ['v2', '不鏽鋼螺絲', 'M6×20 SUS304', '五金', '支', 2.2, 2000, 5], ['v2', '深溝滾珠軸承', '6204ZZ', '機械零件', '個', 68, 20, 5],
    ['v2', '深溝滾珠軸承', '6205ZZ', '機械零件', '個', 82, 20, 5], ['v2', '三角皮帶', 'A-42', '機械零件', '條', 145, 5, 7],
    ['v3', '五層紙箱', '60×40×40cm', '包裝材料', '個', 32, 100, 3], ['v3', '氣泡布', '120cm×100m', '包裝材料', '捲', 480, 2, 3],
    ['v3', 'OPP 封箱膠帶', '48mm×100m 透明', '包裝材料', '捲', 28, 36, 2], ['v3', '棧板膜', '50cm×300m', '包裝材料', '捲', 260, 6, 3],
    ['v4', '電阻', '1/4W 10kΩ', '電子零件', '包', 120, 1, 7], ['v4', '端子台', 'TB-2504', '電子零件', '個', 35, 10, 7],
    ['v4', 'PVC 電線', '1.25mm² 黑', '電子零件', '捲', 950, 1, 5], ['v5', '棉紗手套', '600g', '耗材', '打', 78, 20, 2],
    ['v5', '工業酒精', '95% 4L', '耗材', '桶', 420, 4, 3], ['v5', '擦拭布', '30×30cm 50入', '耗材', '包', 150, 10, 2],
    ['v6', 'OPP 封箱膠帶', '48mm×100m 透明', '包裝材料', '捲', 32, 12, 1], ['v6', 'A4 影印紙', '70g 500張', '辦公用品', '包', 115, 10, 1],
    ['v6', '五層紙箱', '60×40×40cm', '包裝材料', '個', 38, 20, 1],
  ];
  const O = [ // [日期差, 廠商, 品名, 規格, 數量, 單位, 單價, 需求日差, 申請人, 進度, 簽核, 已到貨, 備註, 退回原因]
    [0, 'v2', '不鏽鋼螺絲', 'M6×20 SUS304', 2000, '支', 2.2, 5, '生產課', 'todo', 'l1', 0, ''],
    [0, 'v3', '五層紙箱', '60×40×40cm', 300, '個', 32, 3, '出貨組', 'todo', 'approved', 0, '下週出貨用'],
    [0, 'v5', '棉紗手套', '600g', 30, '打', 78, 2, '廠務課', 'todo', 'l2', 0, ''],
    [0, 'v6', 'A4 影印紙', '70g 500張', 20, '包', 115, 2, '行政組', 'ordered', 'approved', 0, ''],
    [0, 'v2', '深溝滾珠軸承', '6204ZZ', 40, '個', 68, 7, '保養課', 'todo', 'draft', 0, '數量待確認'],
    [-1, 'v3', 'OPP 封箱膠帶', '48mm×100m 透明', 72, '捲', 28, 1, '出貨組', 'partial', 'approved', 36, ''],
    [-1, 'v5', '工業酒精', '95% 4L', 8, '桶', 420, 2, '品保課', 'ordered', 'approved', 0, ''],
    [-1, 'v4', '端子台', 'TB-2504', 100, '個', 35, 6, '生產課', 'todo', 'rejected', 0, '', '數量請依工單重新確認'],
    [-2, 'v4', 'PVC 電線', '1.25mm² 黑', 3, '捲', 950, 4, '生產課', 'todo', 'l1', 0, ''],
    [-3, 'v2', '三角皮帶', 'A-42', 10, '條', 145, -1, '保養課', 'ordered', 'approved', 0, '2 號產線備品'],
    [-3, 'v3', '氣泡布', '120cm×100m', 4, '捲', 480, 0, '出貨組', 'received', 'approved', 4, ''],
  ];
  const at = (dayStr, h, m) => { const d = parseYmd(dayStr); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const vk = {}, vname = {};
  const vendors = V.map(([k, name, category, contact, phone, terms, leadDays]) => { const id = rid() + k; vk[k] = id; vname[k] = name; return { id, name, category, contact, phone, email: '', terms, leadDays, note: '', sample: true, createdAt: nowIso(), updatedAt: nowIso() }; });
  const products = P.map(([k, name, spec, category, unit, pr, moq, leadDays], i) => ({ id: rid() + 'p' + i, vendorId: vk[k], name, spec, category, unit, price: pr, moq, leadDays, note: '', sample: true, updatedAt: nowIso() }));
  const seq = {};
  const H = (act, at_, extra) => ({ id: rid() + Math.random().toString(36).slice(2, 5), act, by: '', at: at_, ...extra });
  const orders = O.map(([off, k, item, spec, qty, unit, pr, needOff, requester, progress, approval, recv, note, rej], i) => {
    const date = addDays(T, off), pre = 'PO' + date.replace(/-/g, '');
    const existing = D.orders().filter(o => (o.no || '').startsWith(pre + '-')).length;
    seq[pre] = (seq[pre] || existing) + 1;
    const created = at(date, 8, 40 + i), h = [H('create', created)];
    let submittedAt = null, approvedAt = null, orderedAt = null, receivedAt = null;
    if (approval !== 'draft') { submittedAt = at(date, 9, 5 + i); h.push(H('submit', submittedAt, { role: '申請人' })); }
    if (['l2', 'approved'].includes(approval)) h.push(H('approve', at(date, 10, 10 + i), { role: '主管' }));
    if (approval === 'approved') { approvedAt = at(date, 11, 2 + i); h.push(H('approve', approvedAt, { role: '經理' })); }
    if (approval === 'rejected') h.push(H('reject', at(date, 10, 30), { role: '主管', note: rej }));
    if (['ordered', 'partial', 'received'].includes(progress)) { orderedAt = at(date, 13, 30 + i); h.push(H('progress', orderedAt, { to: 'ordered' })); }
    if (progress === 'partial') h.push(H('progress', at(addDays(date, 1), 9, 20), { to: 'partial', add: recv }));
    if (progress === 'received') { receivedAt = at(addDays(date, 2), 10, 0); h.push(H('progress', receivedAt, { to: 'received' })); }
    return {
      id: rid() + 'o' + i, no: pre + '-' + String(seq[pre]).padStart(3, '0'), date, item, spec, qty, unit, vendorId: vk[k], vendorName: vname[k],
      price: pr, amount: Math.round(qty * pr * 100) / 100, needBy: addDays(T, needOff), requester, note, progress, approval,
      receivedQty: recv, createdBy: '範例', createdAt: created, submittedAt, approvedAt, orderedAt, receivedAt, rejectNote: rej || '',
      history: h, sample: true, updatedAt: nowIso(),
    };
  });
  PBStore.saveMany('vendors', vendors);
  PBStore.saveMany('products', products);
  PBStore.saveMany('orders', orders);
  if (!D.materials().length) loadSampleMaterials();
  toast('範例資料已載入，都標有「範例」。');
}
function clearSample() {
  if (!isAdmin()) return;
  let n = 0;
  for (const k of ['orders', 'products', 'vendors', 'materials']) { const ids = D[k]().filter(x => x.sample).map(x => x.id); n += ids.length; if (ids.length) PBStore.removeMany(k, ids); }
  toast(`已清除 ${n} 筆範例資料。`);
}

/* ---------- 事件 ---------- */
function arm(t) {
  const orig = t.textContent;
  t.classList.add('arm'); t.textContent = t.dataset.confirm;
  setTimeout(() => { if (t.isConnected && t.classList.contains('arm')) { t.classList.remove('arm'); t.textContent = orig; } }, 4000);
}
document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-open], [data-cday]');
  if (!t || t.closest('#f-offers') || t.closest('#loginGate')) return;
  const d = t.dataset;
  if (d.confirm && !t.classList.contains('arm')) { arm(t); return; }
  if ('close' in d) return closeDialog();
  if (d.open) return openDetail(d.open);
  if (d.scope) { S.scope = d.scope; S.flag = null; return render(); }
  if (d.kpi) {
    if (d.kpi === 'appr') { location.hash = 'approvals'; return; }
    if (d.kpi === 'day') { S.flag = null; S.scope = 'day'; } else S.flag = S.flag === d.kpi ? null : d.kpi;
    return render();
  }
  if ('clearFlag' in d) { S.flag = null; return render(); }
  if ('sync' in d || t.id === 'sync') { PBStore.syncNow(); return; }
  if (d.cat !== undefined) { S.pcat = d.cat; return render(); }
  if ('pall' in d) { S.pall = true; return render(); }
  if (d.vmode) { S.vmode = d.vmode; return render(); }
  if ('mflag' in d) { S.mflag = S.mflag === d.mflag && d.mflag ? '' : d.mflag; return render(); }
  if (d.mat) return openMatDetail(d.mat);
  if (d.editMat) return openMatForm(PBStore.get('materials', d.editMat));
  if ('addMat' in d) return openMatForm(null);
  if (d.matFrom) { const p = PBStore.get('products', d.matFrom); return openMatForm(null, p ? { name: p.name, spec: p.spec, category: p.category, unit: p.unit } : null); }
  if ('importMat' in d) return openMatImport();
  if ('matSample' in d) return loadSampleMaterials();
  if ('matExport' in d) return exportMatCsv();
  if (d.vendor !== undefined) { S.pvendor = d.vendor; S.vmode = 'products'; closeDialog(); if (S.view !== 'vendors') location.hash = 'vendors'; else render(); return; }
  if (d.orderProduct) {
    const p = PBStore.get('products', d.orderProduct); if (!p) return;
    return openOrderForm(null, { item: p.name, spec: p.spec, unit: p.unit, vendorId: p.vendorId, price: num(p.price) > 0 ? p.price : '', qty: p.moq || '', date: today(), needBy: p.leadDays ? addDays(today(), num(p.leadDays)) : '' });
  }
  if (d.editProduct) return openProductForm(PBStore.get('products', d.editProduct));
  if (d.editVendor) return openVendorForm(vById.get(d.editVendor));
  if ('newOrder' in d) return openOrderForm();
  if ('addVendor' in d) return openVendorForm();
  if ('addProduct' in d) return openProductForm();
  if ('import' in d) return openImport();
  if ('sample' in d) return loadSample();
  if ('reloadUsers' in d) return loadUsers();
  if (d.editUser) return openUserForm((U.list || []).find(u => u.email === d.editUser));
  if (d.toggleUser) { const u = (U.list || []).find(x => x.email === d.toggleUser); if (u) userCall('userSave', { email: u.email, name: u.name, pages: u.pages, enabled: !u.enabled }, u.enabled ? `已停用 ${u.email}` : `已啟用 ${u.email}`); return; }
  if (d.delUser) return userCall('userDelete', { email: d.delUser }, `已刪除 ${d.delUser}`);
  if (d.cday) { S.cday = d.cday; S.cmonth = d.cday.slice(0, 7); return render(); }
  if (d.ev) return openEventDetail(d.ev);
  if ('newev' in d) return openEventForm(null, d.newev || S.cday);
  if (d.evedit) return openEventForm(PBStore.get('events', d.evedit));
  if (d.evdel) return deleteEvent(d.evdel);
  if (d.dact) return dailyAct(d.dact, t);
  if (d.dmode) { S.dmode = d.dmode; return render(); }
  if (d.dday) { S.dday = d.dday; return render(); }
  if (d.dperson) return openPersonDay(d.dperson);
  if ('tedit' in d || d.tmove || d.tstop || d.trestore || d.tdel) return taskSettingAct(d);
  if (d.go) { location.hash = d.go; return; }
  if (d.goflag) { S.flag = d.goflag; if (S.view === 'orders') render(); else location.hash = 'orders'; return; }
  if (d.act) {
    if (d.act === 'clear-sample') return clearSample();
    if (d.act === 'delete-vendor') {
      if (!can('vendor')) return;
      const v = vById.get(d.id); if (!v) return;
      const ps = D.products().filter(p => p.vendorId === v.id).map(p => p.id);
      closeDialog(); if (S.pvendor === v.id) S.pvendor = '';
      if (ps.length) PBStore.removeMany('products', ps);
      PBStore.remove('vendors', v.id);
      return toast(`已刪除 ${v.name}${ps.length ? ` 和 ${ps.length} 項產品` : ''}`);
    }
    if (d.act === 'delete-material') { if (!can('vendor')) return; const m = PBStore.get('materials', d.id); closeDialog(); if (m) { PBStore.remove('materials', m.id); toast(`已刪除原料 ${m.name}`); } return; }
    if (d.act === 'delete-product') { if (!can('vendor')) return; const p = PBStore.get('products', d.id); closeDialog(); if (p) { PBStore.remove('products', p.id); toast(`已刪除 ${p.name}`); } return; }
    return orderAct(d.act, PBStore.get('orders', d.id), t);
  }
});
$('#newOrderBtn').addEventListener('click', () => openOrderForm());
$('#logoutBtn').addEventListener('click', () => PBAuth.logout());
$('#addUserBtn').addEventListener('click', () => openUserForm());
$('#exportBtn').addEventListener('click', exportCsv);
$('#day').addEventListener('change', e => { if (e.target.value) { S.day = e.target.value; S.scope = 'day'; S.flag = null; render(); } });
$('#prevDay').addEventListener('click', () => { S.day = addDays(S.day, -1); S.scope = 'day'; S.flag = null; render(); });
$('#nextDay').addEventListener('click', () => { S.day = addDays(S.day, 1); S.scope = 'day'; S.flag = null; render(); });
$('#todayBtn').addEventListener('click', () => { S.day = today(); S.scope = 'day'; S.flag = null; render(); });
$('#dday').addEventListener('change', e => { if (e.target.value) { S.dday = e.target.value; render(); } });
$('#dprevDay').addEventListener('click', () => { S.dday = addDays(S.dday, -1); render(); });
$('#dnextDay').addEventListener('click', () => { S.dday = addDays(S.dday, 1); render(); });
$('#dtodayBtn').addEventListener('click', () => { S.dday = today(); render(); });
$('#dailyBody').addEventListener('change', onDailyChange);
const shiftMonth = n => { const [y, m] = S.cmonth.split('-').map(Number), d = new Date(y, m - 1 + n, 1); S.cmonth = ymd(d).slice(0, 7); S.cday = S.cmonth === today().slice(0, 7) ? today() : S.cmonth + '-01'; render(); };
$('#cprev').addEventListener('click', () => shiftMonth(-1));
$('#cnext').addEventListener('click', () => shiftMonth(1));
$('#ctodayBtn').addEventListener('click', () => { S.cday = today(); S.cmonth = S.cday.slice(0, 7); render(); });
$('#corders').addEventListener('change', e => { S.corders = e.target.checked; LS.set('pb_cal_orders', S.corders); render(); });
S.corders = LS.get('pb_cal_orders', true) !== false;
$('#dailyBody').addEventListener('submit', onDailySubmit);
dlg.addEventListener('change', onDialogChange);
$('#oq').addEventListener('input', e => { S.q = e.target.value.trim(); renderOrders(); });
$('#pq').addEventListener('input', e => { S.pq = e.target.value.trim(); renderVendors(); });
$('#mq').addEventListener('input', e => { S.mq = e.target.value.trim(); renderVendors(); });
$('#pvendor').addEventListener('change', e => { S.pvendor = e.target.value; renderVendors(); });
window.addEventListener('hashchange', route);

let tt;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  if (el.showPopover) { try { if (el.matches(':popover-open')) el.hidePopover(); el.showPopover(); } catch (e) {} }
  clearTimeout(tt);
  tt = setTimeout(() => { if (el.hidePopover) { try { el.hidePopover(); } catch (e) {} } el.hidden = true; }, 3400);
}

/* ---------- 啟動 ---------- */
PBStore.on((type, payload) => {
  if (type === 'change') onData();
  else if (type === 'status') { renderSync(); renderBanner(); if (payload && payload.state === 'synced') ensureMe(); }
  else if (type === 'conflict') toast('有同事同時修改了同一筆資料，已自動合併；同一個欄位以你的修改為準。');
});
PBAuth.on(() => { route(); });
PBAuth.ready.then(() => { onData(); route(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('service-worker.js').catch(() => {}); });
}
// 跨日（App 開著過午夜）時，「今天」與逾期判斷跟著更新
let lastDay = today();
setInterval(() => { const t = today(); if (t !== lastDay) { if (S.day === lastDay) S.day = t; if (S.dday === lastDay) S.dday = t; if (S.cday === lastDay) { S.cday = t; S.cmonth = t.slice(0, 7); } lastDay = t; ensureMe(); render(); } }, 60000);
})();
