// Documents (the PDFs): finding them in what was read, naming them, and remembering what is already saved in Drive (the "ledger", tm_weekly/docs.json).
// Plain functions, no browser and no network, so they can be tested. The downloading and the saving are in tm_weekly.js.
//
// A document is recognised by the code in its link (it stays the same from week to week). The first time an application is seen, everything on it is
// "baseline": it is saved to Drive but never announced as new. Anything that appears later is "new" and is announced in the email.

const KINDS = ['Examreport', 'ShowCorrespondence', 'GetDocuments'];   // the three kinds of "View" link on the e-Register
const MAX_TRIES = 3;                                                  // a document that fails is tried again on later runs, up to this many times
const showDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const cleanName = (t) => String(t || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
const keyOf = (no, id) => `${no}|${id}`;
const tokenOf = (link) => { const m = /\?(.+)$/.exec(String(link || '')); return m ? m[1] : ''; };

const emptyLedger = () => ({ version: 1, seededApps: {}, folders: {}, docs: {} });

// Every document that has a real "View" link on this application's Correspondence and Uploaded Documents screens (each one once).
function collectDocs(no, now) {
  const out = []; const seen = new Set();
  for (const list of [(now && now.correspondence) || [], (now && now.documents) || []]) {
    for (const r of list) {
      for (const l of r.links || []) {
        if (/^javascript/i.test(l)) continue;
        const kind = KINDS.find((k) => String(l).includes(k));
        const id = tokenOf(l);
        if (!kind || !id || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, kind, date: r.date || null, title: String(r.title || '').trim() || kind, link: l });
      }
    }
  }
  return out;
}

// Adds what was just found to the ledger. Returns the keys that were not known before.
function addDiscovered(ledger, no, found, today) {
  const baseline = !ledger.seededApps[no];
  const fresh = [];
  for (const d of found) {
    const k = keyOf(no, d.id);
    if (ledger.docs[k]) continue;
    ledger.docs[k] = { app: no, id: d.id, kind: d.kind, date: d.date, title: d.title, link: d.link, firstSeen: today, baseline, status: 'pending', tries: 0 };
    fresh.push(k);
  }
  if (!ledger.seededApps[no]) ledger.seededApps[no] = today;
  return fresh;
}

// "Hearing Notice for Application No. 1234567 (29 Oct 2026).pdf": what it is first, the date after; if two documents of one application would get the
// same name, the second gets (2). The suffix is for copies that were made smaller, e.g. " (reduced size)".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (iso) => (iso ? `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : 'undated');
function fileNameFor(ledger, entry, suffix = '') {
  const base = `${cleanName(entry.title).slice(0, 110)} (${longDate(entry.date)})${suffix}`;
  const used = new Set(Object.values(ledger.docs).filter((x) => x.app === entry.app && x.fileName && x.id !== entry.id).map((x) => x.fileName));
  let name = `${base}.pdf`; let n = 2;
  while (used.has(name)) name = `${base} (${n++}).pdf`;
  return name;
}

// What still has to be saved for one application, newest first (so the most useful documents are saved first if time runs out).
function pendingFor(ledger, no) {
  return Object.values(ledger.docs)
    .filter((d) => d.app === no && d.status !== 'saved' && d.status !== 'too_large' && (d.tries || 0) < MAX_TRIES)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

// Plain words for why a document is not in Drive (never the technical error).
function reasonOf(d) {
  if (d.status === 'too_large') return `too large to save (${Math.max(1, Math.round((d.bytes || 0) / 1048576))} MB). Open it on the e-Register`;
  if ((d.tries || 0) >= MAX_TRIES) return `could not be downloaded after ${MAX_TRIES} tries. Open it on the e-Register`;
  if (d.status === 'failed') return 'could not be downloaded this time; it will be tried again next run';
  return 'not saved yet; it will be saved on the next run';
}

// What the email needs about one application's documents.
function docsView(ledger, no, today) {
  const all = Object.values(ledger.docs).filter((d) => d.app === no);
  const saved = all.filter((d) => d.status === 'saved');
  const urls = {}; saved.forEach((d) => { urls[d.id] = d.url; });
  return {
    total: all.length,
    saved: saved.length,
    folderUrl: (ledger.folders[no] && ledger.folders[no].url) || '',
    urls,
    newlySaved: saved.filter((d) => !d.baseline && d.savedOn === today),
    unsaved: all.filter((d) => d.status !== 'saved').map((d) => ({ title: d.title, date: d.date, isNew: !d.baseline, reason: reasonOf(d) })),
  };
}

module.exports = { KINDS, MAX_TRIES, emptyLedger, collectDocs, addDiscovered, fileNameFor, pendingFor, reasonOf, docsView, keyOf, tokenOf, showDate };
