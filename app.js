'use strict';
/* BETCHAR - demo. Datos: TheSportsDB (partidos/resultados) y open.er-api.com (USD→COP).
   Cuotas simuladas (no hay API pública gratuita de cuotas). Pagos simulados en el navegador. */
const $ = s => document.querySelector(s);
const COP = n => '$' + Math.round(n).toLocaleString('es-CO');
const API = 'https://www.thesportsdb.com/api/v1/json/3/';
const LEAGUES = { 4328: 'Premier League', 4335: 'LaLiga', 4480: 'Champions League', 4346: 'MLS' };
const KEY = 'betchar_v1';
const LIM = { depMin: 10000, depMax: 2000000, wdMin: 20000, betMin: 1000 };
const METHODS = {
  nequi: { name: 'Nequi', label: 'Celular Nequi', re: /^3\d{9}$/, hint: '10 dígitos, empieza por 3' },
  pse: { name: 'PSE', label: 'Documento o cuenta', re: /^\d{6,16}$/, hint: 'Entre 6 y 16 dígitos' },
  bancolombia: { name: 'Bancolombia', label: 'Cuenta de ahorros', re: /^\d{9,12}$/, hint: 'Entre 9 y 12 dígitos' },
  card: { name: 'Tarjeta', label: 'Número de tarjeta', re: /^\d{13,19}$/, hint: 'Solo depósitos', luhn: true, depOnly: true }
};

let S = JSON.parse(localStorage.getItem(KEY) || 'null') || { bal: 50000, bets: [], tx: [], age: false };
let events = [], league = 4328, slip = null, rate = 0, mode = 'dep', method = 'nequi', busy = false;
const save = () => { localStorage.setItem(KEY, JSON.stringify(S)); render(); };
const toast = (m, err) => { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = m; $('#toasts').append(t); setTimeout(() => t.remove(), 4000); };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = t => new Date(/Z|[+-]\d\d:?\d\d$/.test(t) ? t : t + 'Z').toLocaleString('es-CO', { timeZone: 'America/Bogota', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const luhn = n => { let s = 0, d = false; for (let i = n.length - 1; i >= 0; i--) { let x = +n[i]; if (d && (x *= 2) > 9) x -= 9; s += x; d = !d; } return s % 10 === 0; };

/* Cuotas determinísticas por partido, con margen de la casa del 7% */
function odds(id) {
  const h = hash(id), a = .28 + (h % 30) / 100, d = .2 + ((h >> 8) % 10) / 100, b = Math.max(.12, 1 - a - d), t = a + d + b;
  return [a, d, b].map(p => +(0.93 * t / p).toFixed(2));
}
const demo = () => [['Millonarios', 'Atlético Nacional'], ['América de Cali', 'Junior'], ['Real Madrid', 'Barcelona'], ['Arsenal', 'Liverpool']]
  .map((m, i) => ({ id: 'd' + i, h: m[0], a: m[1], t: new Date(Date.now() + (i + 1) * 864e5).toISOString() }));

async function load() {
  $('#events').innerHTML = '<p class="muted">Cargando partidos…</p>';
  try {
    const r = await fetch(`${API}eventsnextleague.php?id=${league}`);
    const j = await r.json();
    events = (j.events || []).map(e => ({ id: e.idEvent, h: e.strHomeTeam, a: e.strAwayTeam, t: e.strTimestamp || `${e.dateEvent}T${e.strTime || '00:00:00'}`, hb: e.strHomeTeamBadge, ab: e.strAwayTeamBadge }));
    if (!events.length) throw 0;
  } catch { events = demo(); toast('No se pudo leer la API. Se muestran partidos de ejemplo.', 1); }
  render();
}
async function loadRate() {
  try { const j = await (await fetch('https://open.er-api.com/v6/latest/USD')).json(); rate = j.rates.COP; $('#rate').textContent = `US$ 1 = ${COP(rate)} COP`; render(); } catch { }
}

/* ---------- Render ---------- */
function render() {
  $('#bal').textContent = COP(S.bal);
  $('#usd').textContent = rate ? `≈ US$ ${(S.bal / rate).toFixed(2)}` : '';
  $('#tabs').innerHTML = Object.entries(LEAGUES).map(([id, n]) => `<button class="${+id === league ? 'on' : ''}" data-lg="${id}">${n}</button>`).join('');
  $('#events').innerHTML = events.map(e => {
    const o = odds(e.id);
    return `<article class="ev"><div class="when">${fmtDate(e.t)}</div>
    <div class="teams"><span>${e.hb ? `<img src="${esc(e.hb)}/tiny" alt="">` : ''}${esc(e.h)}</span><span>${esc(e.a)}${e.ab ? `<img src="${esc(e.ab)}/tiny" alt="">` : ''}</span></div>
    <div class="odds">${['1', 'X', '2'].map((p, i) => `<button class="odd ${slip && slip.id === e.id && slip.pick === p ? 'on' : ''}" data-ev="${e.id}" data-pick="${p}">${p === '1' ? 'Local' : p === 'X' ? 'Empate' : 'Visita'}<b>${o[i].toFixed(2)}</b></button>`).join('')}</div></article>`;
  }).join('');
  renderSlip();
  $('#bets').innerHTML = S.bets.length ? S.bets.slice(0, 8).map(b => `<div class="item"><div>${esc(b.h)} vs ${esc(b.a)}<small>Pick ${b.pick} @ ${b.odd.toFixed(2)} · ${COP(b.stake)}</small></div><b class="${b.st}">${{ pend: 'Pendiente', won: '+' + COP(b.stake * b.odd), lost: 'Perdida' }[b.st]}</b></div>`).join('') : '<p class="muted">Aún no tienes apuestas.</p>';
  $('#txs').innerHTML = S.tx.length ? S.tx.slice(0, 8).map(t => `<div class="item"><div>${t.type === 'dep' ? 'Depósito' : 'Retiro'} · ${esc(t.method)}<small>${esc(t.ref)} · ${esc(t.acct)}</small></div><b class="${t.type === 'dep' ? 'in' : 'out'}">${t.type === 'dep' ? '+' : '-'}${COP(t.amt)}</b></div>`).join('') : '<p class="muted">Sin movimientos todavía.</p>';
}
function renderSlip() {
  const el = $('#slip');
  if (!slip) { el.innerHTML = '<h2>TU BOLETA</h2><p class="empty">Toca una cuota para armar tu apuesta.</p>'; return; }
  const stake = +($('#stake')?.value || slip.stake || 5000);
  el.innerHTML = `<h2>TU BOLETA</h2><div class="pick">${esc(slip.h)} vs ${esc(slip.a)}<br>Pick: ${slip.pick === '1' ? 'Gana local' : slip.pick === 'X' ? 'Empate' : 'Gana visita'} @ ${slip.odd.toFixed(2)}</div>
  <label>Monto a apostar (COP)<input id="stake" type="number" min="${LIM.betMin}" step="1000" value="${stake}"></label>
  <div class="win"><span>Ganancia posible</span><b id="win">${COP(stake * slip.odd)}</b></div><button class="btn" id="place">Apostar</button>`;
  $('#stake').oninput = e => { slip.stake = +e.target.value; $('#win').textContent = COP(slip.stake * slip.odd); };
}

/* ---------- Apuestas ---------- */
function placeBet() {
  const stake = +$('#stake').value;
  if (!(stake >= LIM.betMin)) return toast(`El mínimo es ${COP(LIM.betMin)}`, 1);
  if (stake > S.bal) return toast('Saldo insuficiente. Deposita para continuar.', 1);
  S.bal -= stake;
  S.bets.unshift({ id: 'B' + Date.now(), eid: slip.id, h: slip.h, a: slip.a, pick: slip.pick, odd: slip.odd, stake, st: 'pend' });
  slip = null; save(); toast('Apuesta registrada');
}
async function settle() {
  let n = 0;
  for (const b of S.bets.filter(b => b.st === 'pend')) {
    let res = null;
    if (String(b.eid).startsWith('d')) res = ['1', 'X', '2'][hash(b.eid + Date.now()) % 3]; // demo
    else try {
      const e = (await (await fetch(`${API}lookupevent.php?id=${b.eid}`)).json()).events?.[0];
      if (e && e.intHomeScore != null && e.intHomeScore !== '') res = +e.intHomeScore > +e.intAwayScore ? '1' : +e.intHomeScore === +e.intAwayScore ? 'X' : '2';
    } catch { }
    if (!res) continue;
    b.st = res === b.pick ? 'won' : 'lost'; if (b.st === 'won') S.bal += b.stake * b.odd; n++;
  }
  save(); toast(n ? `${n} apuesta(s) resuelta(s)` : 'Aún no hay resultados finales para tus apuestas.', !n);
}

/* ---------- Pasarela de pagos (simulada) ---------- */
function openPay(m) { mode = m; method = 'nequi'; $('#amt').value = ''; $('#pay').hidden = false; drawPay(); }
function drawPay() {
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  if (METHODS[method].depOnly && mode === 'wd') method = 'nequi';
  $('#methods').innerHTML = Object.entries(METHODS).filter(([, m]) => !(mode === 'wd' && m.depOnly)).map(([k, m]) => `<button data-m="${k}" class="${k === method ? 'on' : ''}">${m.name}</button>`).join('');
  const m = METHODS[method];
  $('#chips').innerHTML = (mode === 'dep' ? [20000, 50000, 100000, 200000] : [20000, 50000, 100000]).map(v => `<button data-chip="${v}">${COP(v)}</button>`).join('');
  $('#fields').innerHTML = `<label>${m.label}<input id="acct" inputmode="numeric" autocomplete="off" placeholder="${m.hint}"></label>` +
    (m.luhn ? '<label>Vence (MM/AA)<input id="exp" placeholder="08/29" maxlength="5"></label><label>CVV<input id="cvv" inputmode="numeric" maxlength="4" type="password"></label>' : '');
  $('#payNote').textContent = mode === 'dep' ? `Mínimo ${COP(LIM.depMin)}, máximo ${COP(LIM.depMax)}. Acreditación inmediata (simulada).` : `Mínimo ${COP(LIM.wdMin)}. Requiere al menos un depósito previo. Disponible: ${COP(S.bal)}.`;
  $('#payGo').textContent = mode === 'dep' ? 'Depositar' : 'Retirar';
}
async function pay() {
  if (busy) return;
  const amt = +$('#amt').value, m = METHODS[method], acct = $('#acct').value.replace(/\s/g, '');
  const bad = msg => toast(msg, 1);
  if (!Number.isInteger(amt) || amt <= 0) return bad('Ingresa un monto válido');
  if (mode === 'dep' && (amt < LIM.depMin || amt > LIM.depMax)) return bad(`El depósito debe estar entre ${COP(LIM.depMin)} y ${COP(LIM.depMax)}`);
  if (mode === 'wd') {
    if (amt < LIM.wdMin) return bad(`El retiro mínimo es ${COP(LIM.wdMin)}`);
    if (amt > S.bal) return bad('Saldo insuficiente');
    if (!S.tx.some(t => t.type === 'dep')) return bad('Haz un depósito antes de retirar');
  }
  if (!m.re.test(acct)) return bad(`${m.label} inválido: ${m.hint}`);
  if (m.luhn) {
    if (!luhn(acct)) return bad('Número de tarjeta inválido');
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test($('#exp').value)) return bad('Fecha de vencimiento inválida');
    if (!/^\d{3,4}$/.test($('#cvv').value)) return bad('CVV inválido');
  }
  busy = true; $('#payGo').disabled = true; $('#payGo').textContent = 'Procesando…';
  await new Promise(r => setTimeout(r, 1600)); // simula respuesta de la pasarela
  const ref = 'BC' + Date.now().toString(36).toUpperCase();
  S.bal += mode === 'dep' ? amt : -amt;
  S.tx.unshift({ ref, type: mode, amt, method: m.name, acct: '••••' + acct.slice(-4), ts: Date.now() });
  busy = false; $('#payGo').disabled = false; $('#pay').hidden = true; save();
  toast(`${mode === 'dep' ? 'Depósito' : 'Retiro'} aprobado · Ref ${ref}`);
}

/* ---------- Eventos ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.lg) { league = +t.dataset.lg; slip = null; load(); }
  else if (t.dataset.ev) { const ev = events.find(x => x.id === t.dataset.ev), i = ['1', 'X', '2'].indexOf(t.dataset.pick); slip = { id: ev.id, h: ev.h, a: ev.a, pick: t.dataset.pick, odd: odds(ev.id)[i], stake: slip?.stake || 5000 }; render(); }
  else if (t.id === 'place') placeBet();
  else if (t.id === 'settle') settle();
  else if (t.dataset.pay) openPay(t.dataset.pay);
  else if (t.dataset.mode) { mode = t.dataset.mode; drawPay(); }
  else if (t.dataset.m) { method = t.dataset.m; drawPay(); }
  else if (t.dataset.chip) $('#amt').value = t.dataset.chip;
  else if (t.id === 'payGo') pay();
  else if (t.id === 'payCancel') $('#pay').hidden = true;
  else if (t.id === 'ageOk') { S.age = true; save(); $('#age').hidden = true; }
});
$('#age').hidden = S.age;
load(); loadRate();
