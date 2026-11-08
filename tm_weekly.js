// WEEKLY TRADEMARK CHECK for the IP India e-Register (read only).
// You open it, log in yourself (email/mobile + OTP + the small sum). It then goes through the applications in apps.txt one by one,
// reads Status, Reminders, Correspondence & Notices and Uploaded Documents, compares with LAST run, and writes:
//   tm_weekly/<date>/report.md       what is new, a proposed Notion "Status" cell per application, a two-line summary
//   tm_weekly/<date>/raw_<no>.json   everything it read
// It never writes to Notion and never changes anything on the site. Downloads only happen if you say yes at the end.
//
// First time only, in this folder:   npm install playwright
// Every Monday:                      node tm_weekly.js          (or  node tm_weekly.js 1234567 1234568  for just those)
// Test the reading logic offline:    node tm_weekly.js --selftest
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const BASE = 'https://tmrsearch.ipindia.gov.in';
const STATE = path.join(process.cwd(), 'tm_weekly');
const WATCH_WORDS = /hearing|show cause|refus|abandon|opposition|advertis|accept|registration|certificate|examination/i;

// ------------------------------------------------------------------ reading ----
const DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
// Reminders use month/day/year; the other screens day/month/year.
function toIso(text, monthFirst) {
  const m = DATE_RE.exec(text || '');
  if (!m) return null;
  const [a, b, y] = [Number(m[1]), Number(m[2]), m[3]];
  const [d, mo] = monthFirst ? [b, a] : [a, b];
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const showDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

// Turns one list answer (HTML, or JSON holding HTML) into rows: { cells, date, title, links }.
function parseList(body, monthFirst, parseHtml) {
  let html = body;
  try { const j = JSON.parse(body); html = typeof j === 'string' ? j : JSON.stringify(j).replace(/\\"/g, '"').replace(/\\n|\\r|\\t/g, ' '); } catch (e) { /* plain HTML */ }
  const rows = parseHtml(html);
  return rows.filter((r) => r.cells.some(Boolean)).map((r) => {
    const dateCell = r.cells.find((c) => DATE_RE.test(c));
    const titleCell = r.cells.filter((c) => c && c !== dateCell && !/^\d+$/.test(c.replace(/\s/g, '')) && !/^view$/i.test(c)).sort((x, y) => y.length - x.length)[0] || '';
    return { cells: r.cells, date: toIso(dateCell, monthFirst), title: titleCell, links: r.links || [] };
  });
}
const rowKey = (r) => r.cells.join(' | ');

// Runs in the browser: rows of cell text plus any link addresses.
function parseHtmlInBrowser(html) {
  const d = new DOMParser().parseFromString(html, 'text/html');
  return [...d.querySelectorAll('tr')].map((tr) => ({
    cells: [...tr.querySelectorAll('th,td')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
    links: [...tr.querySelectorAll('a,button,input[type=button]')].map((a) => a.getAttribute('href') || a.getAttribute('onclick') || '').filter(Boolean),
  })).filter((r) => r.cells.length && !r.cells.every((c) => /^#?$|^(sr\.?\s*no\.?|s\.?no\.?)$/i.test(c)));
}

// ------------------------------------------------------------------ comparing ----
function compare(now, before) {
  const out = { statusChanged: false, newRows: { reminders: [], correspondence: [], documents: [] } };
  if (!before) return { ...out, first: true };
  out.statusChanged = (before.status || '') !== (now.status || '');
  for (const k of Object.keys(out.newRows)) {
    const had = new Set((before[k] || []).map(rowKey));
    out.newRows[k] = (now[k] || []).filter((r) => !had.has(rowKey(r)));
  }
  return out;
}

// One line per event, latest first, in the style of the Notion cell.
function notionCell(now, asOf) {
  const label = { reminders: '', correspondence: '', documents: '' };
  const events = [];
  for (const k of Object.keys(label)) for (const r of now[k] || []) if (r.date) events.push({ date: r.date, text: r.title || r.cells.join(' ') });
  events.sort((a, b) => b.date.localeCompare(a.date));
  const seen = new Set();
  const lines = events.filter((e) => { const key = e.date + e.text; if (seen.has(key)) return false; seen.add(key); return true; }).map((e) => `${showDate(e.date)} ${e.text}.`);
  return `Status (as on ${asOf}): ${now.status || 'not read'}. ${lines.join(' ')}`.trim();
}

function buildReport(results, asOf) {
  const md = [`# Weekly trademark check, ${asOf}`, ''];
  const summaryBits = [];
  const alerts = [];
  for (const r of results) {
    md.push(`## ${r.no}${r.title ? ` (${r.title})` : ''}`);
    if (r.error) { md.push(`**Could not be read:** ${r.error}`, ''); summaryBits.push(`${r.no}: not read`); continue; }
    md.push(`Status now: **${r.now.status || 'not read'}**${r.now.subStatus ? ` (sub status: ${r.now.subStatus})` : ''}${r.now.klass ? `. Class ${r.now.klass}` : ''}${r.now.proprietor ? `. ${r.now.proprietor}` : ''}`);
    const c = r.diff;
    if (c.first) md.push('First run, so there is nothing earlier to compare with.');
    else {
      const n = c.newRows;
      const items = [...n.reminders, ...n.correspondence, ...n.documents];
      md.push(c.statusChanged ? `**Status changed.**` : 'Status unchanged.');
      md.push(items.length ? `New since last run:\n${[['Reminders', n.reminders], ['Correspondence', n.correspondence], ['Documents', n.documents]].flatMap(([t, a]) => a.map((x) => `- ${t}: ${showDate(x.date)} ${x.title || x.cells.join(' ')}`)).join('\n')}` : 'Nothing new on the four screens.');
      for (const x of items) if (WATCH_WORDS.test(x.title || x.cells.join(' '))) alerts.push(`${r.no}: ${showDate(x.date)} ${x.title}`);
      summaryBits.push(`${r.no} ${r.now.status || '?'}${c.statusChanged ? ' (CHANGED)' : ''}${items.length ? `, ${items.length} new item(s)` : ', no change'}`);
    }
    if (r.diff.first) summaryBits.push(`${r.no} ${r.now.status || '?'}`);
    md.push('', 'Proposed Notion cell:', '```', notionCell(r.now, asOf), '```', '');
  }
  md.push('## Needs your eye', alerts.length ? alerts.map((a) => `- ${a}`).join('\n') : 'Nothing with a hearing, show-cause, refusal, acceptance or similar title is new.', '');
  md.push('## Two-line summary for the group', summaryBits.join('. ') + '.', '');
  md.push('Note: hearing dates are written inside the hearing notice itself, not on these screens. Open the notice (Correspondence, View) or its saved PDF.');
  return md.join('\n');
}

// ------------------------------------------------------------------ helpers ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = (lo = 3000, hi = 6000) => sleep(lo + Math.random() * (hi - lo));
const CI = !!process.env.CI;
const ask = (q) => CI ? Promise.reject(new Error('Needs a person to type something (captcha could not be read).')) : new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a.trim()); }); });
const today = () => new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }); // dd/mm/yyyy
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// ------------------------------------------------------------------ the site ----
// The small test on the search page comes in kinds: "Enter the first number in 9 8 3 6= ?" (pick a digit), or a sum like "3 + 6 = ?".
const ORDINALS = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5, seventh: 6, eighth: 7, ninth: 8, tenth: 9 };
function answerCaptcha(instruction, boxText) {
  const text = `${instruction || ''} ${boxText || ''}`;
  const sum = /(\d+)\s*([+\-x×*])\s*(\d+)/i.exec(boxText || '');
  if (sum) { const [a, op, b] = [Number(sum[1]), sum[2], Number(sum[3])]; return String(op === '+' ? a + b : op === '-' ? a - b : a * b); }
  const pick = /(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)\s+(?:number|digit)/i.exec(text);
  const digits = (/([\d\s]{2,})\s*=/.exec(boxText || '') || [])[1];
  const d = digits ? digits.replace(/\s+/g, '') : '';
  if (pick && d) { const w = pick[1].toLowerCase(); return w === 'last' ? d[d.length - 1] : d[ORDINALS[w]] || null; }
  return null;
}

// The test can take a few seconds (even a minute) to appear, so wait for it instead of giving up.
async function solveCaptcha(page, waitMs = 40000) {
  const box = page.locator('#CaptchModel_CaptchaNumbers');
  const started = Date.now();
  let boxText = '';
  while (Date.now() - started < waitMs) {
    boxText = (await box.inputValue().catch(() => '')) || (await box.innerText().catch(() => ''));
    if (/\d/.test(boxText) && /[=?]/.test(boxText)) break;
    await sleep(1000);
  }
  const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
  const instruction = (/Enter the [^\n]{3,40}?(?:number|digit)[^\n]{0,10}/i.exec(pageText) || [''])[0];
  const answer = answerCaptcha(instruction, boxText);
  if (answer === null || answer === undefined) { console.log(`  The test did not load or I could not read it (waited ${Math.round((Date.now() - started) / 1000)} s). Page said: "${instruction}" / "${boxText}"`); return false; }
  console.log(`  test: "${instruction.trim()} ${boxText.trim()}" -> ${answer}`);
  await page.locator('[name="CaptchModel.CaptchaAnswer"]').fill(answer);
  return true;
}

// The Reminders / Correspondence / Documents lists open in a pop-up (#ViewModel). It must be closed before the next button can be pressed.
async function closeModal(page) {
  const modal = page.locator('#ViewModel');
  if (!(await modal.isVisible().catch(() => false))) return;
  const closer = modal.locator('[data-bs-dismiss="modal"], [data-dismiss="modal"], .btn-close, button.close, .modal-footer button').first();
  if (await closer.count()) await closer.click({ timeout: 4000 }).catch(() => {});
  if (await modal.isVisible().catch(() => false)) await page.keyboard.press('Escape').catch(() => {});
  await modal.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await sleep(600);
}

// Clicks the visible button/link/tab whose words match (never a hidden pop-up title).
async function clickWords(page, re) {
  const items = page.locator('button, a, input[type=button], input[type=submit], label, .btn');
  const n = await items.count();
  for (let i = 0; i < n; i++) {
    const it = items.nth(i);
    if (!(await it.isVisible().catch(() => false))) continue;
    const t = ((await it.innerText().catch(() => '')) || (await it.getAttribute('value').catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (re.test(t)) { await it.click(); return t; }
  }
  const seen = [];
  for (let i = 0; i < n; i++) { const it = items.nth(i); if (await it.isVisible().catch(() => false)) seen.push(((await it.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim()); }
  throw new Error(`No visible button like ${re}. Visible buttons: ${seen.filter(Boolean).join(' | ')}`);
}

// Always through the menu, choosing "National/IRDI Number" (a round radio option, never "International Registration Number").
async function chooseNational(page) {
  const tries = [
    () => page.getByLabel(/National\s*\/\s*IRDI/i).first().check({ timeout: 4000 }),
    () => page.getByText(/National\s*\/\s*IRDI/i).first().click({ timeout: 4000 }),
    () => page.locator('input[type=radio]').first().check({ force: true, timeout: 4000 }),
    () => page.locator('input[type=radio]').first().click({ force: true, timeout: 4000 }),
  ];
  for (const t of tries) {
    await t().catch(() => {});
    if (await page.locator('#ApplicationNumber').isVisible({ timeout: 6000 }).catch(() => false)) return true;
    // Some pages need a button after the choice.
    await clickWords(page, /^(submit|go|search|proceed|next|view)$/i).catch(() => {});
    if (await page.locator('#ApplicationNumber').isVisible({ timeout: 6000 }).catch(() => false)) return true;
  }
  return false;
}

async function openSearch(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${BASE}/estatus/TradeMarkApplication/eregister`, { waitUntil: 'domcontentloaded' });
    await pause(1500, 2500);
    if (await page.locator('#ApplicationNumber').isVisible().catch(() => false)) {   // the site remembered the last choice
      const t0 = await page.evaluate(() => document.body.innerText);
      if (!/International Registration (Number|Details)/i.test(t0)) return;
    }
    if (!(await chooseNational(page))) {
      const radios = await page.evaluate(() => [...document.querySelectorAll('input[type=radio]')].map((r) => `${r.id || r.name}=${r.value}`).join(', '));
      console.log(`  Could not get the search form. Radio options on the page: ${radios || 'none found'}. Url: ${page.url()}`);
      continue;
    }
    const text = await page.evaluate(() => document.body.innerText);
    if (!/International Registration (Number|Details)/i.test(text)) return;
    console.log('  That opened the International form; going back to choose National/IRDI again.');
  }
  throw new Error('Could not get the National/IRDI search form after 3 tries. Stopped.');
}

async function readApplication(page, no, previous) {
  await openSearch(page);
  await pause();
  let ok = false;
  for (let tries = 0; tries < 3 && !ok; tries++) {
    await page.locator('#ApplicationNumber').fill(no);
    let solved = await solveCaptcha(page);
    if (!solved && tries < 2) { console.log(`  Trying ${no} again from the start (try ${tries + 2} of 3).`); await pause(); await openSearch(page); continue; }
    if (!solved) { await ask(`  Type the answer in the browser yourself for ${no} and press View, then press Enter here... `); }
    else await page.locator('#btnView').click({ timeout: 15000 });
    await page.waitForURL(/\/RegisteredTM/i, { timeout: 25000 }).catch(() => {});
    await pause(2500, 4000);
    ok = page.url().includes('/RegisteredTM');
    if (!ok) { console.log(`  Search for ${no} did not open (try ${tries + 1} of 3).`); await pause(); await openSearch(page); }
  }
  if (!ok) throw new Error('The search did not open after 3 tries (captcha or site problem). Stopped on this one.');

  const statusText = await page.evaluate(() => document.body.innerText);
  // Label/value pairs from the result page (Status, Sub Status, Trade Mark, Class, Proprietor ...), from its tables and label elements.
  const fields = await page.evaluate(() => {
    const out = {}; const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    // Tables with a header row over a data row (Application Number | Date | Class | Filing Mode | Trade Mark ...): match them column by column.
    document.querySelectorAll('table').forEach((tb) => {
      const trs = [...tb.querySelectorAll('tr')];
      for (let i = 0; i + 1 < trs.length; i++) {
        const h = [...trs[i].children].map((x) => clean(x.textContent)); const d = [...trs[i + 1].children].map((x) => clean(x.textContent));
        if (h.length >= 4 && h.length === d.length && h.some((x) => /^(class|trade ?mark|mark|application)/i.test(x))) h.forEach((k, j) => { const key = k.replace(/:$/, ''); if (key && d[j] && !(key in out)) out[key] = d[j]; });
      }
    });
    document.querySelectorAll('tr').forEach((tr) => {
      const c = [...tr.children].map((x) => clean(x.textContent));
      if (c.length > 4) return;   // wide rows are header/data rows, read above
      for (let i = 0; i + 1 < c.length; i += 2) { const k = c[i].replace(/:$/, ''); if (k && k.length < 40 && c[i + 1] && !(k in out)) out[k] = c[i + 1]; }
    });
    document.querySelectorAll('label,b,strong,th,dt,span,div').forEach((el) => {
      if (el.children.length > 1) return;
      const k = clean(el.textContent).replace(/:$/, '');
      if (!/^((current )?status|sub ?status|trade ?mark|mark|class|proprietor|applicant|application (no|number))/i.test(k) || k.length > 40) return;
      const n = el.nextElementSibling; let v = n ? clean(n.textContent) : '';
      if (!v && el.parentElement && el.parentElement.nextElementSibling) v = clean(el.parentElement.nextElementSibling.textContent);
      if (v && v.length < 150 && !(k in out)) out[k] = v;
    });
    return out;
  });
  const pick = (re, not) => { const k = Object.keys(fields).find((x) => re.test(x) && !(not && not.test(x))); return k ? fields[k] : ''; };
  let status = fields.Status || fields['Current Status'] || pick(/status/i, /sub|information|application status/i);
  if (!status) { const lines = statusText.split('\n').map((x) => x.trim()).filter(Boolean); const i = lines.findIndex((x) => /^(current )?status\s*:?$/i.test(x)); if (i >= 0) status = lines[i + 1] || ''; }
  const title = pick(/^(trade ?mark|mark)\b/i, /number|date|no\b/i) || '';
  const now = { status: status.trim(), subStatus: fields['Sub Status'] || pick(/sub ?status/i), proprietor: pick(/proprietor|applicant/i), klass: fields.Class || pick(/^class/i), fields, reminders: [], correspondence: [], documents: [], checkedOn: todayIso(), pageText: statusText.slice(0, 6000) };

  const screens = [['reminders', /reminder/i, 'RegisteredTM/GetReminders', true], ['correspondence', /correspondence/i, 'RegisteredTM/GetCorrespondence', false], ['documents', /uploaded documents|documents/i, 'RegisteredTM/GetDocumentsDetails', false]];
  const loaded = { status: !!now.status };
  for (const [key, btn, endpoint, monthFirst] of screens) {
    let got = null;
    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      const wait = page.waitForResponse((r) => r.url().includes(endpoint) && r.request().method() === 'POST', { timeout: 12000 }).catch(() => null);
      await closeModal(page);
      await clickWords(page, btn);
      got = await wait;
      if (!got) await pause(1500, 2500);
    }
    if (got) {
      const body = await got.text();
      let html = body; try { const j = JSON.parse(body); html = typeof j === 'string' ? j : JSON.stringify(j); } catch (e) { /* plain */ }
      const rows = await page.evaluate(parseHtmlInBrowser, html);
      now[key] = parseList(JSON.stringify(html), monthFirst, () => rows);
      loaded[key] = true;
    } else console.log(`  ${key} did not load for ${no}; left empty.`);
    await pause(2000, 3000);
    await closeModal(page);
    await pause(1500, 3000);
  }
  // A screen that did not load must never look like "nothing new": the application then counts as NOT checked (and is tried again).
  const missing = missingParts(loaded);
  if (missing.length) throw new Error(`Incomplete read: ${missing.join(', ')} did not load.`);
  return { no, title, now, diff: compare(now, previous), before: previous || null };
}

// Which parts of an application's page were not read (status, reminders, correspondence, documents).
function missingParts(loaded) { return ['status', 'reminders', 'correspondence', 'documents'].filter((k) => !loaded[k]); }

async function offerDownloads(page, results, outDir) {
  const wanted = [];
  for (const r of results) if (r.diff && !r.diff.first) for (const x of r.diff.newRows.correspondence) if (x.links.length) wanted.push({ no: r.no, row: x });
  if (!wanted.length) return console.log('No new notices with a link to download.');
  console.log('\nNew notices that can be downloaded:'); wanted.forEach((w, i) => console.log(`  ${i + 1}) ${w.no}  ${showDate(w.row.date)}  ${w.row.title}`));
  if (!/^y/i.test(await ask('Download these? (y/N) '))) return;
  for (const w of wanted) {
    const link = w.row.links.find((l) => /href|\.aspx|\/|http/i.test(l) && !/javascript:void/i.test(l)) || '';
    const url = /^https?:/i.test(link) ? link : /^\//.test(link) ? BASE + link : /RegisteredTM\//.test(link) ? `${BASE}/estatus/${link.replace(/^.*(RegisteredTM\/[^'")\s]+).*$/, '$1')}` : null;
    if (!url) { console.log(`  ${w.no}: could not tell the address from "${link}". Open it by hand.`); continue; }
    try {
      const res = await page.context().request.get(url);
      const type = res.headers()['content-type'] || '';
      const ext = /pdf/i.test(type) ? 'pdf' : /html/i.test(type) ? 'html' : /image/i.test(type) ? 'png' : 'bin';
      const file = path.join(outDir, `${w.no}_${w.row.date || 'undated'}_${(w.row.title || 'notice').replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}.${ext}`);
      fs.writeFileSync(file, await res.body());
      console.log(`  saved ${file}`);
    } catch (e) { console.log(`  ${w.no}: download failed (${e.message}).`); }
    await pause(2500, 4500);
  }
}


// Sends one row per application to the Google Sheet (see google_sheet_script.gs), if config.json has the link and the secret.
async function pushToSheet(results, asOf, reportText) {
  let cfg = {};
  if (process.env.SHEET_URL && process.env.SHEET_SECRET) cfg = { sheetUrl: process.env.SHEET_URL.trim(), secret: process.env.SHEET_SECRET.trim() };
  else try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (e) { { console.log('(No config.json, so nothing was sent to a Google Sheet.)'); return false; } }
  if (!cfg.sheetUrl || !cfg.secret) { console.log('(config.json has no sheetUrl/secret yet, so nothing was sent to a Google Sheet.)'); return false; }
  if (typeof fetch !== 'function') { console.log('This Node is too old to send to the sheet. Install the current Node from nodejs.org.'); return false; }
  const rows = results.map((r) => {
    if (r.error) return { checkedOn: asOf, application: r.no, mark: '', klass: '', status: 'NOT READ', subStatus: '', changed: '', newItems: r.error.slice(0, 200) };
    const n = r.diff && r.diff.newRows ? [...r.diff.newRows.reminders, ...r.diff.newRows.correspondence, ...r.diff.newRows.documents] : [];
    return { checkedOn: asOf, application: r.no, mark: r.title || '', klass: r.now.klass || '', status: r.now.status || '', subStatus: r.now.subStatus || '',
      changed: r.diff.first ? 'first run' : (r.diff.statusChanged ? 'YES' : 'no'),
      newItems: r.diff.first ? '' : n.map((x) => `${showDate(x.date)} ${x.title || x.cells.join(' ')}`).join(' | ') };
  });
  const summary = (/## Two-line summary for the group\n([^\n]*)/.exec(reportText) || [])[1] || '';
  try {
    const res = await fetch(cfg.sheetUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: cfg.secret, rows, summary }) });
    const txt = await res.text();
    if (/"ok":\s*true/.test(txt)) { console.log(`Sent ${rows.length} row(s) to the Google Sheet.`); return true; }
    else if (/<!DOCTYPE|<html/i.test(txt)) {
      const title = (/<title>([^<]*)<\/title>/i.exec(txt) || [])[1] || '(no title)';
      const words = txt.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      console.log(`Google answered with a web page, not the sheet.\n  Status: ${res.status}\n  Page title: ${title}\n  Page words: ${words}\n  Final address: ${String(res.url).replace(/\?.*$/, '?...')}\n  (Copy these 4 lines and send them to Claude.)`);
    } else console.log(`The Google Sheet did not accept it: ${txt.slice(0, 200)}`);
  } catch (e) { console.log(`Could not reach the Google Sheet (${e.message}). The report file is still saved.`); }
  return false;
}

// ------------------------------------------------------------------ self test ----
async function selfTest() {
  let bad = 0; const check = (ok, n) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) bad++; };
  const fake = (html) => { // a tiny stand-in for the browser's table reader
    return [...html.matchAll(/<tr>(.*?)<\/tr>/gs)].map((m) => ({ cells: [...m[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gs)].map((c) => c[1].replace(/<[^>]+>/g, '').trim()), links: [...m[1].matchAll(/href="([^"]+)"/g)].map((l) => l[1]) }));
  };
  const rem = parseList('<tr><td>989629</td><td>08/17/2026 08:08:01</td><td>MIS-R REMINDER-I</td></tr>', true, fake);
  check(rem[0].date === '2026-08-17' && /REMINDER-I/.test(rem[0].title), 'Reminders read month/day/year');
  const cor = parseList('<tr><td>24433976</td><td>29/10/2026</td><td>Hearing Notice for Application No. 1000001</td><td><a href="RegisteredTM/ShowCorrespondence?CRS_NO=24433976">View</a></td></tr>', false, fake);
  check(cor[0].date === '2026-10-29' && /Hearing Notice/.test(cor[0].title) && cor[0].links.length === 1, 'Correspondence read day/month/year with its link');
  const before = { status: 'Objected', reminders: [], correspondence: [], documents: [] };
  const now = { status: 'Objected', reminders: rem, correspondence: cor, documents: [] };
  const d = compare(now, before);
  check(d.newRows.correspondence.length === 1 && !d.statusChanged, 'A new notice is found, status unchanged');
  check(compare(now, null).first === true, 'First run has nothing to compare with');
  const cell = notionCell(now, '03/11/2026');
  check(cell.startsWith('Status (as on 03/11/2026): Objected.') && cell.indexOf('29/10/2026') < cell.indexOf('17/08/2026'), 'Notion cell lists the latest first');
  check(answerCaptcha('Enter the first number in', '9 8 3 6= ?') === '9', 'Captcha: first number in 9 8 3 6 is 9');
  check(answerCaptcha('Enter the third number in', '9 8 3 6= ?') === '3', 'Captcha: third number is 3');
  check(answerCaptcha('Enter the last number in', '4 1 7= ?') === '7', 'Captcha: last number');
  check(answerCaptcha('Evaluate the Expression', '3 + 6 = ?') === '9', 'Captcha: a sum');
  check(answerCaptcha('', 'something odd') === null, 'Captcha: an unknown kind is not guessed');
  const rep = buildReport([{ no: '1000001', title: 'samplemark', now, diff: d }], '03/11/2026');
  check(/Hearing Notice/.test(rep) && /Needs your eye/.test(rep), 'The report flags a new hearing notice');
  check(missingParts({ status: true, reminders: true, correspondence: true, documents: true }).length === 0 && missingParts({ status: true, reminders: true, documents: true }).join() === 'correspondence' && missingParts({ reminders: true, correspondence: true, documents: true }).join() === 'status', 'A screen or status that did not load is reported as missing, so the application counts as NOT checked');
  const em = require('./tm_email');
  const mkApp = (no, status, diff, before) => ({ no, title: 'samplemark', now: { status, klass: '9', fields: { 'Trade Mark': 'samplemark' }, correspondence: [], documents: [], reminders: [] }, before, diff });
  const none = { first: false, statusChanged: false, newRows: { reminders: [], correspondence: [], documents: [] } };
  const quiet = em.buildManagerEmail({ results: [mkApp('1000001', 'Objected', none, { status: 'Objected' }), mkApp('1000002', 'Accepted & Advertised', none, { status: 'Accepted & Advertised' })], asOf: '10/11/2026', sheetLink: 'https://docs.google.com/spreadsheets/d/abc', signName: 'Alex' });
  check(/no changes/.test(quiet.subject) && /No changes this week/.test(quiet.html) && !/What changed/.test(quiet.html), 'Manager email: a quiet week says so plainly, with no "What changed" section');
  check(quiet.html.includes('https://docs.google.com/spreadsheets/d/abc') && /Open the full spreadsheet/.test(quiet.html) && quiet.text.includes('Full spreadsheet: https://docs.google.com'), 'Manager email: ends with the link to the spreadsheet');
  check(/Checked on the IP India e-Register\.<br>Regards,<br>Alex/.test(quiet.html) && /e-Register\.\nRegards,\nAlex/.test(quiet.text), 'Manager email: the sign-off is on three lines (Checked on..., Regards, name)');
  check(!/background:#eef0f5/.test(quiet.html) && /max-width:900px/.test(quiet.html) && /@media only screen/.test(quiet.html) && /name="viewport"/.test(quiet.html), 'Manager email: no grey page background; it widens on a laptop and fits a phone');
  const hearing = { cells: ['Hearing Notice for Application No. 1000001'], date: '2026-11-09', title: 'Hearing Notice for Application No. 1000001', links: [] };
  const busy = em.buildManagerEmail({ results: [mkApp('1000001', 'Objected', { first: false, statusChanged: false, newRows: { reminders: [], correspondence: [hearing], documents: [] } }, { status: 'Objected' }), mkApp('1000002', 'Registered', { first: false, statusChanged: true, newRows: { reminders: [], correspondence: [], documents: [] } }, { status: 'Accepted & Advertised' })], asOf: '10/11/2026', sheetLink: '', signName: 'Alex' });
  check(/2 applications with changes/.test(busy.subject) && /What changed/.test(busy.html) && /Hearing Notice for Application No. 1000001/.test(busy.html) && /NEW/.test(busy.html), 'Manager email: a new hearing notice is highlighted under "What changed"');
  check(/Accepted &amp; Advertised<\/b>|Accepted &amp; Advertised &rarr;|Accepted &amp; Advertised \u2192/.test(busy.html.replace(/&rarr;/g, '\u2192')) || /Accepted & Advertised -> Registered/.test(busy.text), 'Manager email: a status change shows from and to');
  const firstRun = em.buildManagerEmail({ results: [mkApp('1000001', 'Objected', { first: true, newRows: {} }, null)], asOf: '10/11/2026' });
  check(/First weekly check/.test(firstRun.html) && !/with changes/.test(firstRun.subject), 'Manager email: the very first run says it is a first check, not "changes"');
  const down = { no: '1000002', error: 'locator.click: Timeout 30000ms exceeded.', before: { status: 'Accepted & Advertised', klass: '45', checkedOn: '2026-11-03', fields: { 'Trade Mark': 'samplemark' } } };
  const withFailure = em.buildManagerEmail({ results: [mkApp('1000001', 'Objected', none, { status: 'Objected' }), down], asOf: '10/11/2026', sheetOk: true });
  const wf = withFailure.html + withFailure.text;
  check(/could not be checked/.test(withFailure.subject) && /Could not be checked this week/.test(withFailure.html) && /1000002/.test(withFailure.html), 'Manager email: an application that still failed is said so plainly (subject, a box, the table)');
  check(/Last known status: Accepted &amp; Advertised \(as of 03\/11\/2026\)/.test(withFailure.html) && /Last known status: Accepted & Advertised \(as of 03\/11\/2026\)/.test(withFailure.text), 'Manager email: it shows what was last known, with the date of that check');
  check(!/locator|Timeout|30000/.test(wf), 'Manager email: the technical error text never appears, only a plain sentence');
  check(!/No changes this week|as they were last week/.test(wf) && /No changes in the 1 application that was checked/.test(withFailure.html), 'Manager email: it never says "no changes" about what it did not check');
  check(!/<td[^>]*>No change<\/td>[\s\S]*1000002/.test(withFailure.html.replace(/<tr[^>]*>/g, '\n<tr>').split('\n').filter((l) => /1000002/.test(l)).join('')) , 'Manager email: the failed application is not given a "No change" line');
  const notReached = em.buildManagerEmail({ results: [mkApp('1000001', 'Objected', none, { status: 'Objected' }), { no: '1000007', error: 'Not reached before the time limit.', before: { status: 'Objected', checkedOn: '2026-11-03' } }], asOf: '10/11/2026' });
  check(/was not reached before the check had to stop/.test(notReached.html) && !/after several tries/.test(notReached.html), 'Manager email: an application that was never tried is not said to have been "tried several times"');
  const incomplete = em.buildManagerEmail({ results: [{ no: '1000001', error: 'Incomplete read: correspondence did not load.', before: { status: 'Objected', checkedOn: '2026-11-03' } }, mkApp('1000002', 'Objected', none, { status: 'Objected' })], asOf: '10/11/2026' });
  check(/Could not be checked this week/.test(incomplete.html) && !/Incomplete read|did not load/.test(incomplete.html + incomplete.text) && !/No changes this week/.test(incomplete.html), 'Manager email: a half-read application (a screen did not load) is "could not be checked", never "no change"');
  const mixed = em.buildManagerEmail({ results: [mkApp('1000001', 'Objected', none, { status: 'Objected' }), mkApp('1000008', 'Objected', { first: true, newRows: {} }, null)], asOf: '10/11/2026' });
  check(/1 newly added application recorded for the first time/.test(mixed.html) && /First check, recorded/.test(mixed.html) && !/All 2 applications are as they were last week/.test(mixed.html), 'Manager email: a newly added application is never described as "no change"');
  const noLink = em.buildManagerEmail({ results: [mkApp('1000001', 'Objected', none, { status: 'Objected' })], asOf: '10/11/2026' });
  check(noLink.html.includes('href="{{SHEET_LINK}}"') && noLink.text.includes('Full spreadsheet: {{SHEET_LINK}}'), 'Manager email: with no link set, a placeholder is left for the Google script to fill in with the sheet\'s own address');
  const sheetDown = em.buildManagerEmail({ results: [mkApp('1000001', 'Objected', none, { status: 'Objected' })], asOf: '10/11/2026', sheetOk: false });
  check(!/added there/.test(sheetDown.html) && /added there/.test(noLink.html), 'Manager email: it only says the week was added to the sheet when it really was');
  check(em.longDate('10/11/2026') === '10 Nov 2026', 'Manager email: dates are written out in words');
  const posted = [];
  const sent = await em.sendViaScript({ sheetUrl: 'https://script.example/exec', secret: 's', kind: 'weekly', mail: quiet }, async (u, o) => { posted.push(JSON.parse(o.body)); return { text: async () => '{"ok":true,"emailed":true}' }; });
  check(sent.ok && posted[0].action === 'email' && posted[0].kind === 'weekly' && !('to' in posted[0]), 'Manager email: the tool sends no address, only "weekly" or "test"');
  const oldScript = await em.sendViaScript({ sheetUrl: 'https://script.example/exec', secret: 's', kind: 'weekly', mail: quiet }, async () => ({ text: async () => '{"ok":true,"rows":0}' }));
  check(!oldScript.ok && /old version/.test(oldScript.error), 'Manager email: the old sheet script answering "ok" is NOT taken as sent');
  // ---- documents (the PDFs) ----
  const td = require('./tm_docs');
  const L = (t, d) => ({ cells: [d, t], date: d, title: t, links: [] });
  const withLink = (row, link) => ({ ...row, links: [link] });
  const nowDocs = { correspondence: [withLink(L('EXAMINATION REPORT', '2026-08-05'), 'RegisteredTM/Examreport?APPLICATION_NUMBER=AAA='), withLink(L('EXAMINATION REPORT', '2026-08-05'), 'RegisteredTM/Examreport?APPLICATION_NUMBER=AAA='), withLink(L('Hearing Notice', '2026-10-29'), 'RegisteredTM/ShowCorrespondence?CRS_NO=BBB='), withLink(L('Reminder', '2026-08-17'), 'javascript:void(0);')], documents: [withLink(L('Reply to Exam Report (MIS-R)', '2026-09-09'), 'RegisteredTM/GetDocuments?DOCUMENT_NO=CCC=')] };
  const found = td.collectDocs('1000007', nowDocs);
  check(found.length === 3 && found.map((d) => d.kind).sort().join() === 'Examreport,GetDocuments,ShowCorrespondence', 'Documents: three real links found; a document listed twice counts once; a "javascript" link is ignored');
  const led = td.emptyLedger();
  const fresh1 = td.addDiscovered(led, '1000007', found, '2026-11-09');
  check(fresh1.length === 3 && Object.values(led.docs).every((d) => d.baseline === true), 'Documents: the first time an application is seen, everything on it is baseline (saved, never announced as new)');
  const found2 = td.collectDocs('1000007', { ...nowDocs, correspondence: [...nowDocs.correspondence, withLink(L('Refusal Order', '2026-11-12'), 'RegisteredTM/ShowCorrespondence?CRS_NO=DDD=')] });
  const fresh2 = td.addDiscovered(led, '1000007', found2, '2026-11-16');
  check(fresh2.length === 1 && led.docs['1000007|CRS_NO=DDD='].baseline === false, 'Documents: a document that appears later is NEW (not baseline)');
  td.addDiscovered(led, '1000002', td.collectDocs('1000002', nowDocs), '2026-11-16');
  check(Object.values(led.docs).filter((d) => d.app === '1000002').every((d) => d.baseline), 'Documents: an application added later is baseline for itself, so its old documents are not announced as new');
  check(td.fileNameFor(led, led.docs['1000007|DOCUMENT_NO=CCC=']) === 'Reply to Exam Report (MIS-R) (09 Sep 2026).pdf', 'Documents: the file name starts with what the document is, the date follows');
  const a = { app: 'X', id: '1', date: '2026-01-01', title: 'Notice' }; const b = { app: 'X', id: '2', date: '2026-01-01', title: 'Notice' };
  const l2 = { docs: { x1: a, x2: b } }; a.fileName = td.fileNameFor(l2, a);
  check(a.fileName === 'Notice (01 Jan 2026).pdf' && td.fileNameFor(l2, b) === 'Notice (01 Jan 2026) (2).pdf' && td.fileNameFor(l2, b, ' (reduced size)') === 'Notice (01 Jan 2026) (reduced size).pdf', 'Documents: two documents with the same name never overwrite each other');
  const l3 = td.emptyLedger(); td.addDiscovered(l3, 'A1', [{ id: 'a', kind: 'GetDocuments', date: '2026-01-01', title: 'old', link: 'x?a' }, { id: 'b', kind: 'GetDocuments', date: '2026-05-01', title: 'newer', link: 'x?b' }, { id: 'c', kind: 'GetDocuments', date: '2026-06-01', title: 'saved', link: 'x?c' }, { id: 'd', kind: 'GetDocuments', date: '2026-07-01', title: 'giveup', link: 'x?d' }], '2026-11-09');
  l3.docs['A1|c'].status = 'saved'; l3.docs['A1|d'].tries = 3;
  check(td.pendingFor(l3, 'A1').map((d) => d.id).join() === 'b,a', 'Documents: what is still to save is newest first, and saved or given-up ones are left out');
  check(!/Error|HTTP|undefined/.test(td.reasonOf({ status: 'failed', tries: 1, error: 'HTTP 500 Error undefined' })) && /too large/.test(td.reasonOf({ status: 'too_large', bytes: 21 * 1048576 })), 'Documents: the reasons are plain words, never the technical error');
  l3.docs['A1|c'].url = 'https://drive.example/c'; l3.docs['A1|c'].savedOn = '2026-11-16'; l3.docs['A1|b'].status = 'saved'; l3.docs['A1|b'].savedOn = '2026-11-16'; l3.docs['A1|b'].baseline = false; l3.docs['A1|b'].url = 'https://drive.example/b'; l3.folders.A1 = { url: 'https://drive.example/folder' };
  const view = td.docsView(l3, 'A1', '2026-11-16');
  check(view.saved === 2 && view.newlySaved.length === 1 && view.newlySaved[0].id === 'b' && view.unsaved.length === 2 && view.urls.b === 'https://drive.example/b', 'Documents: the email view counts saved, NEW (not baseline) and unsaved correctly');
  const withDocs = em.buildManagerEmail({ results: [mkApp('1000001', 'Objected', { first: false, statusChanged: false, newRows: { reminders: [], correspondence: [{ cells: ['x'], date: '2026-11-12', title: 'Hearing Notice', links: ['RegisteredTM/ShowCorrespondence?CRS_NO=ZZZ='] }], documents: [] } }, { status: 'Objected' })], asOf: '16/11/2026', signName: 'Alex', docs: { views: { '1000001': { saved: 4, folderUrl: 'https://drive.example/folder', urls: { 'CRS_NO=ZZZ=': 'https://drive.example/zzz' }, newlySaved: [{ title: 'Hearing Notice' }], unsaved: [{ title: 'Big filing', date: '2026-09-09', isNew: false, reason: 'too large to save (21 MB). Open it on the e-Register' }] } }, seededNow: 0, leftOver: 0, error: '' } });
  check(/View PDFs \(4\)/.test(withDocs.html) && /href="https:\/\/drive\.example\/folder"/.test(withDocs.html) && /Open PDF/.test(withDocs.html) && /href="https:\/\/drive\.example\/zzz"/.test(withDocs.html) && /1 new/.test(withDocs.html), 'Manager email: a "View PDFs (n)" link per application, "Open PDF" beside a new notice, and "1 new"');
  check(/Documents not saved to Drive/.test(withDocs.html) && /too large to save \(21 MB\)/.test(withDocs.html) && /DOCUMENTS NOT SAVED TO DRIVE/.test(withDocs.text) && /\[PDF: https:\/\/drive\.example\/zzz\]/.test(withDocs.text), 'Manager email: a document that is not in Drive is listed with its plain reason (html and text)');
  const seed = em.buildManagerEmail({ results: [mkApp('1000001', 'Objected', { first: true, newRows: {} }, null)], asOf: '09/11/2026', docs: { views: {}, seededNow: 6, leftOver: 2, error: '' } });
  check(/6 documents were saved to Drive for the first time/.test(seed.html) && /2 more documents will be saved on the next run/.test(seed.html), 'Manager email: the first-time saving is announced once, with how many are still to come');
  const docsDown = em.buildManagerEmail({ results: [mkApp('1000001', 'Objected', none, { status: 'Objected' })], asOf: '16/11/2026', docs: { views: {}, seededNow: 0, error: 'The PDF step failed.' } });
  check(/PDF library could not be updated this week, so nothing is said here about new PDFs/.test(docsDown.html), 'Manager email: if the PDF step failed, it says so and claims nothing about new PDFs');
  const noDocs = em.buildManagerEmail({ results: [mkApp('1000001', 'Objected', none, { status: 'Objected' })], asOf: '16/11/2026' });
  check(!/new PDF|View PDFs|not saved to Drive/.test(noDocs.html), 'Manager email: with no PDF information, the email says nothing about PDFs');
  process.exit(bad ? 1 : 0);
}

// ------------------------------------------------------------------ server login, OTP from Gmail, Telegram ----
const EMAIL = (process.env.LOGIN_EMAIL || '').trim();   // the dedicated mailbox that receives the login codes (a GitHub secret)

async function tg(text) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return console.log('(No TELEGRAM_BOT_TOKEN, so no Telegram message: ' + text.slice(0, 100) + ')');
  try {
    const chatFile = path.join(STATE, 'chat_id.txt');
    let chat = (process.env.TELEGRAM_CHAT_ID || '').trim();
    if (!chat) try { chat = fs.readFileSync(chatFile, 'utf8').trim(); } catch (e) { /* not saved yet */ }
    if (!chat) {
      const u = await (await fetch(`https://api.telegram.org/bot${token}/getUpdates`)).json();
      const m = (u.result || []).map((x) => x.message || x.my_chat_member || x.channel_post).filter(Boolean).pop();
      chat = m && m.chat ? String(m.chat.id) : '';
      if (chat) try { fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(chatFile, chat); console.log('Telegram: chat found and remembered.'); } catch (e) { /* ignore */ }
    }
    if (!chat) return console.log('Telegram: NO CHAT FOUND, so this message could not be delivered: ' + text.slice(0, 120) + '');
    for (let i = 0; i < text.length; i += 3800) await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text: text.slice(i, i + 3800) }) });
  } catch (e) { console.log('Telegram failed: ' + e.message); }
}

// Reads the newest mail that arrived after the OTP was requested and returns the digits.
async function waitForOtp(sentAt, timeoutMs = 240000) {
  const { ImapFlow } = require('imapflow');
  const { simpleParser } = require('mailparser');
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!pass) throw new Error('GMAIL_APP_PASSWORD is not set.');
  const started = Date.now();
  let mailErrors = 0;
  while (Date.now() - started < timeoutMs) {
    const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: EMAIL, pass }, logger: false });
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const uids = (await client.search({ since: new Date(Date.now() - 36 * 3600 * 1000) }, { uid: true })) || [];
        for (const uid of uids.sort((a, b) => b - a).slice(0, 8)) {
          const msg = await client.fetchOne(String(uid), { internalDate: true, source: true }, { uid: true });
          if (!msg || new Date(msg.internalDate).getTime() < sentAt - 20000) continue;
          const mail = await simpleParser(msg.source);
          const body = `${mail.subject || ''}\n${mail.text || ''}`;
          if (!/otp|one.?time|verification/i.test(body)) continue;
          const m = /(?:otp|code|password)[^0-9]{0,60}(\d{4,8})/i.exec(body) || /\b(\d{6})\b/.exec(body);
          if (m) {
            console.log(`  OTP mail found after ${Math.round((Date.now() - sentAt) / 1000)} s. Subject: "${mail.subject}". Text: ${body.replace(/\d/g, '#').replace(/\s+/g, ' ').slice(0, 160)}`);
            return m[1];
          }
        }
      } finally { lock.release(); }
    } catch (e) { console.log('  Mailbox read problem: ' + e.message + (e.responseText ? ' / ' + e.responseText : '') + (e.serverResponseCode ? ' / ' + e.serverResponseCode : '')); if (++mailErrors >= 4) throw new Error('Gmail keeps failing: ' + e.message + (e.responseText ? ' / ' + e.responseText : '')); }
    finally { await client.logout().catch(() => {}); }
    await sleep(6000);
  }
  throw new Error('The OTP email did not arrive (or could not be read) within 4 minutes.');
}

// Quick check of the Gmail connection BEFORE asking the site for an OTP, so a Gmail problem does not waste OTP emails.
async function testMailbox() {
  if (!EMAIL) throw new Error('LOGIN_EMAIL is not set in the repo secrets (the Gmail address that receives the login codes).');
  const { ImapFlow } = require('imapflow');
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!pass) throw new Error('GMAIL_APP_PASSWORD is not set in the repo secrets.');
  console.log(`Gmail check: password is ${pass.length} characters long (an app password should be 16).`);
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: EMAIL, pass }, logger: false });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try { console.log(`Gmail check OK: inbox has ${client.mailbox.exists} message(s).`); } finally { lock.release(); }
  } catch (e) {
    throw new Error(`Gmail would not open: ${e.message}${e.responseText ? ' / ' + e.responseText : ''}${e.authenticationFailed ? ' / the app password was refused' : ''}${e.serverResponseCode ? ' / ' + e.serverResponseCode : ''}`);
  } finally { await client.logout().catch(() => {}); }
}

async function dismissOk(page) {
  const ok = page.getByRole('button', { name: /^ok$/i }).first();
  if (await ok.isVisible().catch(() => false)) await ok.click().catch(() => {});
}

async function login(page) {
  await testMailbox();
  for (let attempt = 1; attempt <= 4; attempt++) {
    console.log(`Login try ${attempt} ...`);
    await page.goto(`${BASE}/estatus`, { waitUntil: 'domcontentloaded' });
    await sleep(6000);
    await page.locator('#emailidentifier').fill(EMAIL);
    await sleep(2000);
    // the page refreshes its test a few seconds after loading, so read it last and check it did not change
    let solved = false;
    for (let k = 0; k < 3 && !solved; k++) {
      const before = await page.locator('#CaptchModel_CaptchaNumbers').inputValue().catch(() => '');
      if (!(await solveCaptcha(page, 30000))) { await sleep(3000); continue; }
      await sleep(1500);
      const after = await page.locator('#CaptchModel_CaptchaNumbers').inputValue().catch(() => '');
      solved = before === after || !after;
    }
    if (!solved) { console.log('  Could not solve the login test; trying again from the start.'); await sleep(5000); continue; }
    const sentAt = Date.now();
    await page.locator('#sendOtpBtn').click();
    // The site answers after a few seconds (sometimes slowly): keep looking for up to 30 s, closing its "OTP sent" pop-up if it shows one.
    let boxUp = false, text = '';
    for (let w = 0; w < 30 && !boxUp; w++) {
      await sleep(1000);
      text = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (/already logged in|wait for 90/i.test(text)) break;
      await dismissOk(page);
      boxUp = await page.locator('#otp').isVisible().catch(() => false);
    }
    if (!boxUp && /already logged in|wait for 90/i.test(text)) { console.log('  The site says an earlier login is still open. Waiting 100 s.'); await dismissOk(page); await sleep(100000); continue; }
    if (!boxUp) { console.log('  No OTP box appeared within 30 s. Page said: ' + text.replace(/\s+/g, ' ').slice(-200)); await sleep(15000); continue; }
    console.log('  OTP requested. Reading the Gmail ...');
    const otp = await waitForOtp(sentAt);
    await page.locator('#otp').fill(otp);
    await page.getByRole('button', { name: /verify/i }).first().click();
    try { await page.waitForURL(/\/estatus\/Home\/Index/i, { timeout: 40000 }); console.log('Logged in.'); return; }
    catch (e) { console.log('  OTP was typed but the site did not log in. Page said: ' + (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(-200)); await sleep(15000); }
  }
  throw new Error('Could not log in to the e-Register after 4 tries.');
}

async function logout(page) {
  try {
    const l = page.locator('a, button').filter({ hasText: /log\s?out|sign\s?out/i }).first();
    if (await l.count()) { await l.click({ timeout: 5000 }); await sleep(3000); console.log('Logged out cleanly.'); }
    else console.log('(No logout button found; the site may block a new login for about 90 s.)');
  } catch (e) { console.log('(Logout did not work: ' + e.message + ')'); }
}


// ------------------------------------------------------------------ Drive: saving documents through the Google script ----
// Sends one file to the Google script (saveFile), which stores it in the private "TM Weekly" Drive folder. Only a reply that says "saved" counts.
async function uploadToDrive(cfg, { app, appLabel, name, buf, mime = 'application/pdf' }) {
  const res = await fetch(cfg.sheetUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: cfg.secret, action: 'saveFile', app, appLabel, name, mime, base64: buf.toString('base64') }), signal: AbortSignal.timeout(240000) });
  const txt = await res.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) { /* not JSON */ }
  if (j && j.saved === true && j.url) return { ok: true, ...j };
  if (j && j.ok && !j.saved) return { ok: false, error: 'The Google script is still the old version (it does not save files). Deploy the new version.' };
  if (/<html|Script function not found/i.test(txt)) return { ok: false, error: 'The Google script did not answer as expected. Has the new version been deployed (Deploy > Manage deployments > pencil > New version)?' };
  return { ok: false, error: j && j.error ? String(j.error).slice(0, 150) : `Unexpected answer: ${txt.slice(0, 120)}` };
}

// A tiny valid PDF for the Drive test.
function tinyPdf(text) {
  const stream = `BT /F1 14 Tf 20 50 Td (${text}) Tj ET`;
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>', `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ------------------------------------------------------------------ Documents: download, turn web pages into PDFs, save to Drive ----
const tmDocs = require('./tm_docs');
const DOCS_DEADLINE_MS = 24 * 60 * 1000;   // stop downloading this long after login, so the 30-minute session never runs out (the rest is done next run)
const DOC_MAX_BYTES = 18 * 1024 * 1024;    // a bigger file is not sent to Drive; the email says so plainly
function loadLedger() { try { return JSON.parse(fs.readFileSync(path.join(STATE, 'docs.json'), 'utf8')); } catch (e) { return tmDocs.emptyLedger(); } }
function saveLedger(l) { fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(path.join(STATE, 'docs.json'), JSON.stringify(l, null, 2)); }

// The notices (Hearing Notice, Examination Report ...) are web pages on the site; this prints one as a PDF, with the site's own address as the base so its styles load.
async function htmlToPdf(browser, html) {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const p = await ctx.newPage();
  try {
    const base = `<base href="${BASE}/estatus/">`;
    const doc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html;
    await p.setContent(doc, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    return Buffer.from(await p.pdf({ format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } }));
  } finally { await ctx.close().catch(() => {}); }
}

// A PDF that is too big for Drive through the Google script is made smaller with Ghostscript (the same words, pictures at screen-reading quality) and
// saved as a "(reduced size)" copy. The original stays on the e-Register. Returns null if it cannot be made small enough.
async function shrinkPdf(buf, maxBytes) {
  const { execFile } = require('child_process'); const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmpdf-')); const inFile = path.join(dir, 'in.pdf'); fs.writeFileSync(inFile, buf);
  try {
    for (const preset of ['/ebook', '/screen']) {
      const outFile = path.join(dir, 'out.pdf');
      await new Promise((resolve, reject) => execFile('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', `-dPDFSETTINGS=${preset}`, `-sOutputFile=${outFile}`, inFile], { timeout: 300000 }, (err) => (err ? reject(err) : resolve())));
      const out = fs.readFileSync(outFile);
      if (out.slice(0, 5).toString('latin1').startsWith('%PDF') && out.length <= maxBytes) { console.log(`  made smaller (${preset}): ${Math.round(buf.length / 1048576)} MB -> ${(out.length / 1048576).toFixed(1)} MB`); return out; }
    }
    return null;
  } catch (e) { console.log('  could not make it smaller: ' + e.message); return null; }
  finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
}

// Finds every document on the applications just read, downloads the ones not yet in Drive (a real PDF is saved as it is, a notice page is printed to PDF
// first), saves each through the Google script, and remembers it in tm_weekly/docs.json. Nothing here can stop the report or the email: a problem is
// recorded against the document and said plainly in the email.
async function syncDocuments({ page, chromium, results, sheetCfg, started, today }) {
  const ledger = loadLedger();
  const stats = { savedNow: 0, failedNow: 0, tooLarge: 0, leftOver: 0, reducedNow: 0 };
  let renderer = null; let outOfTime = false; let driveDown = '';
  try {
    for (const r of results) if (!r.error && r.now) tmDocs.addDiscovered(ledger, r.no, tmDocs.collectDocs(r.no, r.now), today);
    for (const r of results) {
      if (r.error || !r.now || outOfTime || driveDown) continue;
      const mark = String(r.title || (r.now.fields && r.now.fields['Trade Mark']) || '').trim();
      const label = (ledger.folders[r.no] && ledger.folders[r.no].label) || (mark ? `${r.no} · ${mark}` : r.no);
      for (const d of tmDocs.pendingFor(ledger, r.no)) {
        if (Date.now() - started > DOCS_DEADLINE_MS) { outOfTime = true; break; }
        d.tries = (d.tries || 0) + 1;
        try {
          const url = /^https?:/i.test(d.link) ? d.link : `${BASE}/estatus/${d.link.replace(/^\/+/, '')}`;
          const res = await page.context().request.get(url, { headers: { Referer: page.url() }, timeout: 120000 });
          if (res.status() !== 200) throw new Error(`HTTP ${res.status()}`);
          let body = await res.body();
          if (!body.slice(0, 5).toString('latin1').startsWith('%PDF')) {
            const html = body.toString('utf8');
            if (!/<(html|body|div|table|p)\b/i.test(html)) throw new Error('not a PDF and not a page');
            renderer = renderer || await chromium.launch({ headless: true, args: ['--no-sandbox'] });
            body = await htmlToPdf(renderer, html);
          }
          let suffix = '';
          if (body.length > DOC_MAX_BYTES) {
            const small = await shrinkPdf(body, DOC_MAX_BYTES);
            if (!small) { d.status = 'too_large'; d.bytes = body.length; stats.tooLarge++; console.log(`  too large to save: ${d.title} (${Math.round(body.length / 1048576)} MB)`); continue; }
            d.reduced = true; d.origBytes = body.length; body = small; stats.reducedNow++;   // the file name and the email do not mention it (the owner's decision); only the ledger and Telegram do
          }
          d.fileName = d.fileName || tmDocs.fileNameFor(ledger, d, suffix);
          const up = await uploadToDrive(sheetCfg, { app: r.no, appLabel: label, name: d.fileName, buf: body });
          if (!up.ok) { if (/old version|did not answer/i.test(up.error)) { d.tries--; driveDown = up.error; } throw new Error(up.error); }
          Object.assign(d, { status: 'saved', fileId: up.fileId, url: up.url, bytes: up.bytes, savedOn: today }); delete d.error;
          ledger.folders[r.no] = { url: up.folderUrl, label }; ledger.rootUrl = up.rootUrl;
          stats.savedNow++; console.log(`  saved: ${r.no} ${d.fileName} (${Math.round((up.bytes || 0) / 1024)} KB)`);
        } catch (e) {
          d.status = 'failed'; d.error = String(e.message).slice(0, 200); stats.failedNow++; console.log(`  could not save ${r.no} "${d.title}": ${d.error}`);
          if (driveDown) break;
        }
        await pause(2500, 5000);
      }
    }
  } finally {
    if (renderer) await renderer.close().catch(() => {});
    saveLedger(ledger);
  }
  stats.leftOver = results.reduce((n, r) => n + (r.error || !r.now ? 0 : tmDocs.pendingFor(ledger, r.no).length), 0);
  const views = {};
  for (const r of results) views[r.no] = tmDocs.docsView(ledger, r.no, today);
  const seededNow = Object.values(ledger.docs).filter((d) => d.baseline && d.status === 'saved' && d.savedOn === today).length;
  if (driveDown) return { views, seededNow, stats, error: driveDown, reducedNow: stats.reducedNow };
  return { views, seededNow, stats, leftOver: stats.leftOver, reducedNow: stats.reducedNow, error: '' };
}

// documents-test: can the server fetch the "View" documents as real PDFs? Tries ONE of each kind of link from what was already saved for one
// application, saves nothing anywhere, and reports (status, type, size, whether it is a real PDF, and the first words if it is a web page).
async function testDocuments(page, last) {
  const no = Object.keys(last)[0];
  const rows = [...((last[no] && last[no].correspondence) || []), ...((last[no] && last[no].documents) || [])];
  const latest = (type) => rows.filter((r) => (r.links || []).some((l) => l.includes(type))).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const lines = [`Application ${no}`];
  for (const type of ['Examreport', 'ShowCorrespondence', 'GetDocuments']) {
    const r = latest(type);
    if (!r) { lines.push(`${type}: none saved to try`); continue; }
    const link = r.links.find((l) => l.includes(type));
    const url = /^https?:/i.test(link) ? link : `${BASE}/estatus/${link.replace(/^\/+/, '')}`;
    try {
      const res = await page.context().request.get(url, { headers: { Referer: page.url() }, timeout: 45000 });
      const body = await res.body();
      const ct = (res.headers()['content-type'] || '').split(';')[0];
      const isPdf = body.slice(0, 5).toString('latin1').startsWith('%PDF');
      const peek = isPdf ? '' : body.slice(0, 6000).toString('utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      const moved = res.url() !== url ? ` (sent on to ${String(res.url()).replace(/\?.*$/, '?...').slice(0, 90)})` : '';
      const line = `${type} - "${r.title}", ${showDate(r.date)}: HTTP ${res.status()}, ${ct || 'no type'}, ${Math.round(body.length / 1024)} KB, ${isPdf ? 'REAL PDF' : 'NOT a PDF'}${moved}${peek ? `. Starts: "${peek}"` : ''}`;
      console.log('  ' + line); lines.push(line);
    } catch (e) { const line = `${type} - "${r.title}": FAILED (${e.message})`; console.log('  ' + line); lines.push(line); }
    await pause(3000, 6000);
  }
  return lines;
}

// ------------------------------------------------------------------ main ----
(async () => {
  if (process.argv.includes('--selftest')) return selfTest();
  if (process.argv.includes('--sheettest')) {
    const now = { status: 'TEST ROW (ignore)', subStatus: '', klass: '', reminders: [], correspondence: [], documents: [] };
    return pushToSheet([{ no: '0000000', title: 'test', now, diff: { first: true, newRows: { reminders: [], correspondence: [], documents: [] } } }], today(), '## Two-line summary for the group\ntest\n');
  }
  const ai = process.argv.indexOf('--alert');
  if (ai >= 0) return tg(process.argv[ai + 1] || 'TM weekly: problem.');

  const mode = process.env.TM_MODE || 'full';
  const sheetCfg = { sheetUrl: (process.env.SHEET_URL || '').trim(), secret: (process.env.SHEET_SECRET || '').trim() };
  const emailMail = (results, asOf, test, sheetOk = true, docs = null) => require('./tm_email').buildManagerEmail({ docs, results, asOf, sheetLink: (process.env.SHEET_LINK || '').trim() || undefined, sheetOk, signName: (process.env.SIGN_NAME || '').trim(), test });
  // email-test: sends a sample of the manager's email to YOU only (the script decides the address). No login, nothing is checked.
  if (mode === 'email-test') {
    const em = require('./tm_email');
    const last0 = fs.existsSync(path.join(STATE, 'last.json')) ? JSON.parse(fs.readFileSync(path.join(STATE, 'last.json'), 'utf8')) : {};
    const r = await em.sendViaScript({ ...sheetCfg, kind: 'test', mail: emailMail(em.sampleResults(last0), today(), true, true, (() => {
      // Real Drive links if the PDFs have been saved already; invented ones (clearly marked) otherwise.
      const led = loadLedger(); const results0 = em.sampleResults(last0);
      if (!Object.values(led.docs).some((d) => d.status === 'saved')) return em.sampleDocs(results0);
      const views = {}; results0.forEach((r) => { views[r.no] = tmDocs.docsView(led, r.no, todayIso()); });
      return { views, seededNow: 0, leftOver: 0, error: '' };
    })()) });
    await tg(r.ok ? 'TM weekly: the TEST email was sent to you only. Check your inbox (and spam).' : `TM weekly: the TEST email could not be sent. ${r.error}`);
    console.log(r.ok ? 'Test email sent.' : `Test email failed: ${r.error}`);
    if (!r.ok) process.exitCode = 1;
    return;
  }
  // drive-test: saves ONE tiny test file into Drive (TM Weekly / _TEST) through the Google script. No login, nothing from the e-Register.
  if (mode === 'drive-test') {
    if (!sheetCfg.sheetUrl || !sheetCfg.secret) { await tg('TM weekly DRIVE TEST: the sheet link or secret is missing.'); process.exitCode = 1; return; }
    const r = await uploadToDrive(sheetCfg, { app: '_TEST', appLabel: '_TEST (you can delete this folder)', name: `Drive test ${todayIso()}.pdf`, buf: tinyPdf('TM Weekly Drive test') });
    await tg(r.ok ? `TM weekly DRIVE TEST OK: one test file was saved in Drive (${r.bytes} bytes). The PDF folders are shared with ${r.sharedWith} address(es) and are otherwise private.\n${r.folderUrl}` : `TM weekly DRIVE TEST FAILED: ${r.error}`);
    console.log(r.ok ? 'Drive test OK.' : `Drive test failed: ${r.error}`);
    if (!r.ok) process.exitCode = 1;
    return;
  }
  // telegram-test: finds your chat, remembers it for good (saved in the repo), and sends one message. No login.
  if (mode === 'telegram-test') { await tg('TM weekly: Telegram test OK. This chat is now remembered, so alerts keep arriving.'); return; }
  const { chromium } = require('playwright');
  const args = process.argv.slice(2).filter((a) => /^\d{6,8}$/.test(a));
  const only = (process.env.ONLY_APPS || '').split(/[\s,]+/).filter((a) => /^\d{6,8}$/.test(a));
  const apps = args.length ? args : only.length ? only : fs.readFileSync(path.join(__dirname, 'apps.txt'), 'utf8').split(/\s+/).filter((a) => /^\d{6,8}$/.test(a));
  if (!apps.length) throw new Error('apps.txt has no application numbers. Add one number per line.');
  fs.mkdirSync(STATE, { recursive: true });
  const lastFile = path.join(STATE, 'last.json');
  const last = fs.existsSync(lastFile) ? JSON.parse(fs.readFileSync(lastFile, 'utf8')) : {};
  const outDir = path.join(STATE, todayIso());
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });   // run under a pretend screen (xvfb)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  try {
    await login(page);
    if (mode === 'documents-test') {
      const lines = await testDocuments(page, last);
      await tg('TM weekly DOCUMENT TEST (nothing saved, nothing changed):\n\n' + lines.join('\n\n'));
      return;
    }
    if (mode === 'login-test') { await tg('TM weekly TEST: login worked from the server (email OTP read automatically). Nothing was checked or changed.'); return; }

    console.log('Reading ' + apps.length + ' application(s), slowly...\n');
    const started = Date.now();
    const results = [];
    for (const no of apps) {
      if (Date.now() - started > 27 * 60 * 1000) { console.log('Nearly 30 minutes used; stopping before the session ends.'); break; }
      console.log(`Reading ${no} ...`);
      try {
        const r = await readApplication(page, no, last[no]);
        fs.writeFileSync(path.join(outDir, `raw_${no}.json`), JSON.stringify(r.now, null, 2));
        results.push(r);
        console.log(`  status: ${r.now.status || 'not read'}; reminders ${r.now.reminders.length}, notices ${r.now.correspondence.length}, documents ${r.now.documents.length}`);
      } catch (e) {
        console.log(`  ${no}: ${e.message}`);
        results.push({ no, error: e.message, before: last[no] || null });
        if (/tries/.test(e.message)) break;
      }
      await pause(5000, 9000);
    }
    // One more try, in the same login, for every application that failed or was never reached (if there is time left in the 30-minute session).
    const again = apps.filter((no) => { const r = results.find((x) => x.no === no); return !r || r.error; });
    if (again.length && Date.now() - started < 20 * 60 * 1000) {
      console.log(`\nTrying again for: ${again.join(', ')}`);
      await pause(20000, 30000);
      for (const no of again) {
        if (Date.now() - started > 27 * 60 * 1000) break;
        console.log(`Reading ${no} again ...`);
        let r;
        try {
          r = await readApplication(page, no, last[no]);
          fs.writeFileSync(path.join(outDir, `raw_${no}.json`), JSON.stringify(r.now, null, 2));
          console.log(`  status: ${r.now.status || 'not read'}; reminders ${r.now.reminders.length}, notices ${r.now.correspondence.length}, documents ${r.now.documents.length}`);
        } catch (e) { console.log(`  ${no}: ${e.message}`); r = { no, error: e.message, before: last[no] || null }; }
        const i = results.findIndex((x) => x.no === no);
        if (i >= 0) results[i] = r; else results.push(r);
        await pause(5000, 9000);
      }
    }
    for (const no of apps) if (!results.some((r) => r.no === no)) results.push({ no, error: 'Not reached before the time limit.', before: last[no] || null });
    results.sort((a, b) => apps.indexOf(a.no) - apps.indexOf(b.no));
    const asOf = today();
    const reportText = buildReport(results, asOf);
    fs.writeFileSync(path.join(outDir, 'report.md'), reportText);
    const merged = { ...last };
    for (const r of results) if (!r.error) merged[r.no] = r.now;
    fs.writeFileSync(lastFile, JSON.stringify(merged, null, 2));
    console.log(reportText);
    const sheetOk = await pushToSheet(results, asOf, reportText);
    // The PDFs: saved to Drive after the rows are sent. A problem here never stops the report or the email; it is said in them.
    let docsInfo = null;
    if (sheetCfg.sheetUrl && sheetCfg.secret && process.env.PDFS !== 'off') {
      try { docsInfo = await syncDocuments({ page, chromium, results, sheetCfg, started, today: todayIso() }); }
      catch (e) { console.log('PDF step failed: ' + e.message); docsInfo = { views: {}, seededNow: 0, stats: { savedNow: 0 }, error: 'The PDF step failed.' }; }
    }
    const bad = results.filter((r) => r.error).length;
    const eye = (/## Needs your eye\n([\s\S]*?)\n\n/.exec(reportText) || [])[1] || '';
    const sum = (/## Two-line summary for the group\n([^\n]*)/.exec(reportText) || [])[1] || '';
    // The manager's email: on the Monday run (or when asked for). Anything that still failed after the tries is SAID in it, plainly, with what was
    // last known; nothing is claimed about it. A run that could not read a single application sends the recipients nothing (the owner is told here instead).
    let mailNote = '';
    if (process.env.TM_EMAIL_MANAGER === '1') {
      if (bad === results.length) mailNote = '\n\nThe manager was NOT emailed because not one application could be read.';
      else if (!sheetCfg.sheetUrl || !sheetCfg.secret) mailNote = '\n\nThe manager was NOT emailed: the sheet link or secret is missing.';
      else {
        try {
          const r = await require('./tm_email').sendViaScript({ ...sheetCfg, kind: 'weekly', mail: emailMail(results, asOf, false, sheetOk, docsInfo) });
          mailNote = r.ok ? `\n\nThe report was emailed to the manager${bad ? ', and it says plainly that ' + bad + ' application(s) could not be checked' : ''}.` : `\n\nThe manager was NOT emailed. ${r.error}`;
        } catch (e) { mailNote = `\n\nThe manager was NOT emailed. ${e.message}`; }
      }
    }
    let docsNote = '';
    if (docsInfo) {
      const newN = Object.values(docsInfo.views || {}).reduce((n, v) => n + (v.newlySaved || []).length, 0);
      docsNote = docsInfo.error ? `\n\nPDFs: NOT updated this run (${docsInfo.error}).` : `\n\nPDFs: ${docsInfo.stats.savedNow} saved to Drive this run (${newN} new)${docsInfo.stats.failedNow ? `, ${docsInfo.stats.failedNow} could not be downloaded` : ''}${docsInfo.stats.reducedNow ? `, ${docsInfo.stats.reducedNow} saved as reduced-size copies (too big to save as they are)` : ''}${docsInfo.stats.tooLarge ? `, ${docsInfo.stats.tooLarge} too large to save` : ''}${docsInfo.stats.leftOver ? `, ${docsInfo.stats.leftOver} still to be saved next run` : ''}.`;
    }
    await tg(`TM weekly ${asOf}${bad ? ` - WARNING: ${bad} of ${apps.length} application(s) could NOT be read` : ''}\n\n${sum}\n\nNeeds your eye:\n${eye}${docsNote}${mailNote}`);
    if (bad) process.exitCode = 1;
  } finally {
    await logout(page);
    await browser.close().catch(() => {});
  }
})().catch(async (e) => { console.error('Stopped:', e.message); await tg('TM weekly FAILED, nothing was checked this time: ' + e.message); process.exit(1); });
