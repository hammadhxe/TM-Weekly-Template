// The Monday email to the manager: a clean, formatted report of what the weekly check found, with the changes highlighted and a button to the
// Google Sheet at the end. Plain functions (no browser, no network) so they can be tested; sendViaScript() is the only part that sends.
//
// The email is sent by the Google Sheet's own script (see google_sheet_script.gs), from the Google account that owns the sheet. The tool never
// sends an address: it only says "weekly" or "test", and the script decides who receives it, so the shared secret cannot be used to mail
// anybody else. An application that could not be read is SAID so in the email (with what was last known); a run in which not one application
// could be read sends the manager nothing (the owner is told on Telegram).

const WATCH_WORDS = /hearing|show cause|refus|abandon|opposition|advertis|accept|registration|certificate|examination/i;
const linkId = (links) => { const l = (links || []).find((x) => !/^javascript/i.test(x)); const m = /\?(.+)$/.exec(l || ''); return m ? m[1] : ''; };
const showDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const longDate = (dmy) => { // "10/11/2026" -> "10 Nov 2026"
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dmy || '');
  if (!m) return String(dmy || '');
  return `${Number(m[1])} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]} ${m[3]}`;
};

// Status colours: amber for Objected, green for Accepted/Registered, a quiet grey for anything else.
function chip(status) {
  const s = String(status || '');
  const [bg, fg] = /object/i.test(s) ? ['#fdecc8', '#7a4b00'] : /accept|regist/i.test(s) ? ['#d9f2e1', '#14633a'] : ['#e8eaef', '#394150'];
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${bg};color:${fg};font-weight:600;font-size:13px;white-space:nowrap;">${esc(s || 'Not read')}</span>`;
}

// What is new for one application: { statusChanged, from, to, items: [{ kind, date, title, key }] }.
function changesOf(r) {
  const d = r.diff || {};
  if (d.first) return { statusChanged: false, items: [] };
  const n = d.newRows || {};
  const items = [];
  for (const [kind, list] of [['Notice', n.correspondence], ['Document', n.documents], ['Reminder', n.reminders]]) {
    for (const x of list || []) {
      const title = x.title || (x.cells || []).join(' ');
      items.push({ kind, date: x.date || null, title, key: WATCH_WORDS.test(title), id: linkId(x.links) });
    }
  }
  items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return { statusChanged: !!d.statusChanged, from: r.before && r.before.status, to: r.now && r.now.status, items };
}

// Plain words for why an application could not be read: never the technical error text.
const WHY_FAILED = 'The e-Register did not give this application\'s details after several tries.';
const WHY_NOT_REACHED = 'This application was not reached before the check had to stop, so it was not looked at.';
const whyOf = (r) => (/^Not reached/i.test(String(r.error || '')) ? WHY_NOT_REACHED : WHY_FAILED);
// The link to the spreadsheet is filled in by the Google script itself (it knows which sheet it belongs to), so no link has to be set up.
const SHEET_PLACEHOLDER = '{{SHEET_LINK}}';

// results: one entry per application. A read one has `now` (and `diff`, `before`); one that could not be read has `error` and, if there is one,
// `before` (what was known at the last successful check, with `checkedOn` when it was saved). sheetOk: this week's rows really reached the sheet.
function buildManagerEmail({ results, asOf, sheetLink, sheetOk = true, signName = '', test = false, docs = null }) {
  const all = (results || []).filter(Boolean);
  const apps = all.filter((r) => !r.error && r.now);
  const failed = all.filter((r) => r.error || !r.now);
  const per = apps.map((r) => ({ r, c: changesOf(r) }));
  const changed = per.filter((p) => p.c.statusChanged || p.c.items.length);
  const first = apps.length > 0 && failed.length === 0 && apps.every((r) => r.diff && r.diff.first);
  const when = longDate(asOf);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [];
  if (!first && changed.length) parts.push(`${plural(changed.length, 'application', 'applications')} with changes`);
  if (failed.length) parts.push(`${plural(failed.length, 'application', 'applications')} could not be checked`);
  const subject = `${test ? '[TEST] ' : ''}Trademark status update, ${when}${first ? '' : parts.length ? `: ${parts.join(', ')}` : ': no changes'}`;
  const link = sheetLink || SHEET_PLACEHOLDER;
  const dv = (no) => (docs && docs.views && docs.views[no]) || null;
  const plural2 = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // Notes about the PDFs under the banner: said only when true.
  const docNotes = [];
  if (docs && docs.error) docNotes.push('The PDF library could not be updated this week, so nothing is said here about new PDFs.');
  else if (docs) {
    if (docs.seededNow) docNotes.push(`${plural2(docs.seededNow, 'document was', 'documents were')} saved to Drive for the first time (folder "TM Weekly").`);
    if (docs.leftOver) docNotes.push(`${plural2(docs.leftOver, 'more document', 'more documents')} will be saved on the next run.`);
  }

  let banner;
  if (failed.length) {
    const said = first ? '' : changed.length ? ` ${changed.length} of the ${apps.length} checked ${changed.length === 1 ? 'has' : 'have'} changes.` : ` No changes in the ${plural(apps.length, 'application', 'applications')} that ${apps.length === 1 ? 'was' : 'were'} checked.`;
    banner = { bg: '#fbe0dd', fg: '#8a1f11', text: `${apps.length} of ${all.length} applications checked. ${plural(failed.length, 'application', 'applications')} could not be read this week (see below).${said}` };
  } else if (first) banner = { bg: '#e8eaef', fg: '#2a3140', text: `First weekly check: ${plural(apps.length, 'application', 'applications')} recorded. From next week, anything new is highlighted below.` };
  else if (changed.length) banner = { bg: '#fdecc8', fg: '#7a4b00', text: `${changed.length} of ${apps.length} application${apps.length === 1 ? '' : 's'} ${changed.length === 1 ? 'has' : 'have'} changes this week.` };
  else {
    const fresh = apps.filter((r) => r.diff && r.diff.first).length;
    banner = fresh
      ? { bg: '#d9f2e1', fg: '#14633a', text: `No changes this week in the ${plural(apps.length - fresh, 'application', 'applications')} already tracked. ${plural(fresh, 'newly added application', 'newly added applications')} recorded for the first time.` }
      : { bg: '#d9f2e1', fg: '#14633a', text: `No changes this week. All ${apps.length} application${apps.length === 1 ? ' is' : 's are'} as they were last week.` };
  }

  const nameOf = (r) => `${esc(r.no)}${(r.title || (r.before && r.before.fields && r.before.fields['Trade Mark'])) ? ` &middot; ${esc(r.title || r.before.fields['Trade Mark'])}` : ''}${(r.now && r.now.klass) || (r.before && r.before.klass) ? ` (Class ${esc((r.now && r.now.klass) || r.before.klass)})` : ''}`;
  const lastKnown = (r) => {
    const b = r.before;
    if (!b || !b.status) return 'No earlier check is on record for this application.';
    return `Last known status: ${b.status}${b.checkedOn ? ` (as of ${showDate(b.checkedOn)})` : ' (from the last successful check)'}.`;
  };

  const failBlocks = failed.map((r) => `<div style="border-left:4px solid #c0392b;background:#fdf1ef;padding:12px 16px;margin:0 0 12px;border-radius:4px;"><div style="font-weight:700;color:#1f2a44;margin-bottom:6px;">${nameOf(r)}</div><div style="color:#2a3140;font-size:14px;">${esc(whyOf(r))} ${esc(lastKnown(r))} Nothing is said here about whether it changed.</div></div>`).join('');

  const changeBlocks = changed.map(({ r, c }) => {
    const lines = [];
    if (c.statusChanged) lines.push(`<li style="margin:4px 0;"><b>Status changed:</b> ${esc(c.from || 'not recorded')} &rarr; <b>${esc(c.to || 'not read')}</b></li>`);
    for (const it of c.items) {
      const mark = it.key ? 'font-weight:700;color:#7a4b00;' : '';
      lines.push(`<li style="margin:4px 0;${mark}">${esc(it.kind)}${it.date ? `, ${esc(showDate(it.date))}` : ''}: ${esc(it.title)}${it.key ? ' &nbsp;<span style="background:#7a4b00;color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;">NEW</span>' : ''}${dv(r.no) && dv(r.no).urls && dv(r.no).urls[it.id] ? ` &nbsp;<a href="${esc(dv(r.no).urls[it.id])}" style="color:#1f2a44;font-weight:700;">Open PDF</a>` : ''}</li>`);
    }
    return `<div style="border-left:4px solid #e0a526;background:#fffaf0;padding:12px 16px;margin:0 0 12px;border-radius:4px;"><div style="font-weight:700;color:#1f2a44;margin-bottom:6px;">${nameOf(r)}</div><div style="margin-bottom:6px;">${chip(r.now.status)}</div><ul style="margin:6px 0 0;padding-left:20px;color:#2a3140;">${lines.join('')}</ul></div>`;
  }).join('');

  const cell = 'padding:10px 12px;border-bottom:1px solid #e3e6ee;';
  const rowOf = (i, inner) => `<tr style="background:${i % 2 ? '#f7f8fb' : '#ffffff'};">${inner}</tr>`;
  const pdfCell = (no) => {
    const v = dv(no);
    if (!v || (!v.saved && !v.unsaved.length)) return '<span style="color:#9aa1ad;">&ndash;</span>';
    const parts = [];
    if (v.saved && v.folderUrl) parts.push(`<a href="${esc(v.folderUrl)}" style="color:#1f2a44;font-weight:700;">View PDFs (${v.saved})</a>`);
    else if (v.saved) parts.push(`${v.saved} saved`);
    if (v.newlySaved.length) parts.push(`<span style="color:#7a4b00;font-weight:700;">${v.newlySaved.length} new</span>`);
    if (v.unsaved.length) parts.push(`<span style="color:#8a1f11;">${v.unsaved.length} not saved</span>`);
    return parts.join('<br>');
  };
  const markOf = (r) => esc(r.title || (r.before && r.before.fields && r.before.fields['Trade Mark']) || '');
  const rows = [
    ...per.map(({ r, c }, i) => rowOf(i, `<td style="${cell}"><b>${esc(r.no)}</b><div style="color:#6b7280;font-size:12px;">${markOf(r)}${r.now.klass ? ` &middot; Class ${esc(r.now.klass)}` : ''}</div></td><td style="${cell}">${chip(r.now.status)}</td><td style="${cell}color:${c.statusChanged || c.items.length ? '#7a4b00' : '#6b7280'};">${first || (r.diff && r.diff.first) ? 'First check, recorded' : c.statusChanged || c.items.length ? `${c.statusChanged ? 'Status changed' : ''}${c.statusChanged && c.items.length ? ', ' : ''}${c.items.length ? `${c.items.length} new item${c.items.length === 1 ? '' : 's'}` : ''}` : 'No change'}</td><td style="${cell}">${pdfCell(r.no)}</td>`)),
    ...failed.map((r, j) => rowOf(per.length + j, `<td style="${cell}"><b>${esc(r.no)}</b><div style="color:#6b7280;font-size:12px;">${markOf(r)}</div></td><td style="${cell}"><span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#fbe0dd;color:#8a1f11;font-weight:600;font-size:13px;white-space:nowrap;">Not checked</span>${r.before && r.before.status ? `<div style="color:#6b7280;font-size:12px;margin-top:4px;">Last known: ${esc(r.before.status)}${r.before.checkedOn ? ` (${esc(showDate(r.before.checkedOn))})` : ''}</div>` : ''}</td><td style="${cell}color:#8a1f11;font-weight:600;">Could not be read</td><td style="${cell}">${pdfCell(r.no)}</td>`)),
  ].join('');
  // Documents that are not in Drive, said plainly with the reason (never hidden, never guessed).
  const problems = all.map((r) => ({ r, v: dv(r.no) })).filter((x) => x.v && x.v.unsaved.length);
  const problemBlock = problems.map(({ r, v }) => `<div style="border-left:4px solid #c0392b;background:#fdf1ef;padding:12px 16px;margin:0 0 12px;border-radius:4px;"><div style="font-weight:700;color:#1f2a44;margin-bottom:6px;">${nameOf(r)}</div><ul style="margin:6px 0 0;padding-left:20px;color:#2a3140;font-size:14px;">${v.unsaved.map((u) => `<li style="margin:3px 0;">${esc(u.title)}${u.date ? `, ${esc(showDate(u.date))}` : ''}: ${esc(u.reason)}.${u.isNew ? ' <b>NEW</b>' : ''}</li>`).join('')}</ul></div>`).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>@media only screen and (max-width:620px){.px{padding-left:14px!important;padding-right:14px!important}.ttl{font-size:19px!important}.tbl td,.tbl th{padding:8px 6px!important;font-size:13px!important}.wrap{padding:0!important}}</style></head><body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td class="wrap" align="center" style="padding:16px 12px;">
<!--[if mso]><table role="presentation" width="900" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:900px;background:#ffffff;border:1px solid #e3e6ee;border-radius:10px;overflow:hidden;font-family:Georgia,'Times New Roman',serif;color:#1f2a44;">
<tr><td style="background:#1f2a44;padding:22px 28px;"><div style="color:#c9a869;font-size:12px;letter-spacing:2px;text-transform:uppercase;">Weekly trademark status</div><div class="ttl" style="color:#ffffff;font-size:22px;font-weight:700;margin-top:4px;">${esc(when)}</div><div style="color:#c9ccd6;font-size:13px;margin-top:4px;">IP India e-Register &middot; ${apps.length} of ${all.length} application${all.length === 1 ? '' : 's'} checked</div></td></tr>
<tr><td class="px" style="padding:20px 28px 4px;"><div style="background:${banner.bg};color:${banner.fg};border-radius:8px;padding:12px 16px;font-size:15px;font-weight:600;">${esc(banner.text)}</div></td></tr>
${docNotes.length ? `<tr><td class="px" style="padding:10px 28px 0;"><div style="font-size:13px;color:#2a3140;">${docNotes.map(esc).join('<br>')}</div></td></tr>` : ''}
${failed.length ? `<tr><td class="px" style="padding:18px 28px 0;"><div style="font-size:16px;font-weight:700;margin-bottom:10px;">Could not be checked this week</div>${failBlocks}</td></tr>` : ''}
${changed.length ? `<tr><td class="px" style="padding:18px 28px 0;"><div style="font-size:16px;font-weight:700;margin-bottom:10px;">What changed</div>${changeBlocks}</td></tr>` : ''}
${problems.length ? `<tr><td class="px" style="padding:18px 28px 0;"><div style="font-size:16px;font-weight:700;margin-bottom:10px;">Documents not saved to Drive</div>${problemBlock}</td></tr>` : ''}
<tr><td class="px" style="padding:18px 28px 0;"><div style="font-size:16px;font-weight:700;margin-bottom:10px;">All applications</div>
<table class="tbl" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e6ee;border-radius:6px;border-collapse:separate;font-size:14px;"><tr style="background:#1f2a44;color:#fff;"><th align="left" style="padding:9px 12px;font-size:12px;">Application</th><th align="left" style="padding:9px 12px;font-size:12px;">Status</th><th align="left" style="padding:9px 12px;font-size:12px;">This week</th><th align="left" style="padding:9px 12px;font-size:12px;">PDFs</th></tr>${rows}</table></td></tr>
<tr><td class="px" align="center" style="padding:26px 28px 8px;"><a href="${esc(link)}" style="display:inline-block;background:#1f2a44;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 28px;border-radius:8px;font-size:15px;">Open the full spreadsheet</a>${sheetOk ? `<div style="color:#6b7280;font-size:12px;margin-top:8px;">This week's results are added there, with every earlier week.</div>` : ''}</td></tr>
<tr><td class="px" style="padding:22px 28px 26px;color:#6b7280;font-size:12px;border-top:1px solid #eef0f5;">Checked on the IP India e-Register.${signName ? `<br>Regards,<br>${esc(signName)}` : ''}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;

  const text = [
    `Weekly trademark status, ${when}`, '', banner.text, ...(docNotes.length ? ['', ...docNotes] : []), '',
    ...(failed.length ? ['COULD NOT BE CHECKED THIS WEEK', ...failed.flatMap((r) => [`${r.no}${r.title ? ` - ${r.title}` : ''}`, `  ${whyOf(r)} ${lastKnown(r)} Nothing is said here about whether it changed.`]), ''] : []),
    ...(changed.length ? ['WHAT CHANGED', ...changed.flatMap(({ r, c }) => [`${r.no}${r.title ? ` - ${r.title}` : ''}`, ...(c.statusChanged ? [`  Status changed: ${c.from || 'not recorded'} -> ${c.to || 'not read'}`] : []), ...c.items.map((it) => `  ${it.kind}${it.date ? `, ${showDate(it.date)}` : ''}: ${it.title}${dv(r.no) && dv(r.no).urls && dv(r.no).urls[it.id] ? ` [PDF: ${dv(r.no).urls[it.id]}]` : ''}`)]), ''] : []),
    ...(problems.length ? ['DOCUMENTS NOT SAVED TO DRIVE', ...problems.flatMap(({ r, v }) => [`${r.no}`, ...v.unsaved.map((u) => `  ${u.title}${u.date ? `, ${showDate(u.date)}` : ''}: ${u.reason}.${u.isNew ? ' NEW' : ''}`)]), ''] : []),
    'ALL APPLICATIONS', ...per.map(({ r }) => `${r.no}${r.title ? ` - ${r.title}` : ''}: ${r.now.status || 'not read'}${dv(r.no) && dv(r.no).saved ? ` | PDFs saved: ${dv(r.no).saved}${dv(r.no).folderUrl ? ` (${dv(r.no).folderUrl})` : ''}` : ''}`), ...failed.map((r) => `${r.no}: NOT CHECKED this week. ${lastKnown(r)}`), '',
    `Full spreadsheet: ${link}`, '',
    'Checked on the IP India e-Register.', ...(signName ? ['Regards,', signName] : []),
  ].join('\n');
  return { subject, html, text };
}

// Posts the email to the Google Sheet's script, which sends it. kind = 'weekly' (to the manager) or 'test' (to the owner only).
async function sendViaScript({ sheetUrl, secret, kind, mail }, fetchImpl = fetch) {
  const res = await fetchImpl(sheetUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret, action: 'email', kind, subject: mail.subject, html: mail.html, text: mail.text }) });
  const body = await res.text();
  // Only the NEW script answers "emailed". The old sheet script answers {"ok":true} to anything, so that alone is never taken as sent.
  if (/"emailed":\s*true/.test(body)) return { ok: true };
  if (/"ok":\s*true/.test(body)) return { ok: false, error: 'The Google script is still the old version (it does not send emails). Deploy the new google_sheet_script.gs as a New version.' };
  if (/Script function not found: doPost|<html/i.test(body)) return { ok: false, error: 'The Google script did not answer as the sheet script. Has the new version of google_sheet_script.gs been deployed as a New version?' };
  return { ok: false, error: `The Google script said: ${body.slice(0, 200)}` };
}

// A realistic sample for the test email: the last real results, plus one clearly-marked invented change so the highlighting can be seen.
function sampleResults(last) {
  // A brand-new setup has no saved data yet: use three invented applications so the test email still shows the layout.
  if (!last || !Object.keys(last).length) {
    const mk = (status, klass, mark) => ({ status, klass, fields: { 'Trade Mark': mark }, correspondence: [], documents: [], reminders: [], checkedOn: '2026-01-01' });
    last = { 1000001: mk('Objected', '9', 'SAMPLE MARK A'), 1000002: mk('Accepted & Advertised', '45', 'SAMPLE MARK B'), 1000003: mk('Objected', '42', 'SAMPLE MARK C') };
  }
  const results = Object.keys(last || {}).map((no) => {
    const now = { ...last[no], correspondence: [...(last[no].correspondence || [])] };
    const title = (now.fields && now.fields['Trade Mark']) || '';
    return { no, title, now, before: now, diff: { first: false, statusChanged: false, newRows: { reminders: [], correspondence: [], documents: [] } } };
  });
  if (results[0]) {
    const sample = { cells: ['SAMPLE ONLY: Hearing Notice (this line is invented for the test)'], date: new Date().toISOString().slice(0, 10), title: 'SAMPLE ONLY: Hearing Notice (this line is invented for the test)', links: [] };
    results[0].diff = { first: false, statusChanged: false, newRows: { reminders: [], correspondence: [sample], documents: [] } };
  }
  return results;
}

// Invented PDF details for the test email only (the links go nowhere real, and the sample says so).
function sampleDocs(results) {
  const views = {};
  (results || []).forEach((r, i) => {
    views[r.no] = { total: 5, saved: 5, folderUrl: 'https://example.com/sample-folder-not-real', urls: {}, newlySaved: i === 0 ? [{ title: 'SAMPLE ONLY' }] : [], unsaved: i === 0 ? [{ title: 'SAMPLE ONLY: a filing (invented)', date: null, isNew: true, reason: 'too large to save (21 MB). Open it on the e-Register' }] : [] };
  });
  return { views, seededNow: 0, leftOver: 0, error: '' };
}

module.exports = { buildManagerEmail, sendViaScript, sampleResults, sampleDocs, changesOf, longDate, SHEET_PLACEHOLDER };
