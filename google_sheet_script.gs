// Paste this over everything in your Google Sheet's script: Extensions > Apps Script. Fill in the lines between the two ===== marks, then Save.
// Then: choose "saveFile" in the dropdown and press Run once (it asks permission to use Drive and to send email: Allow; a red error afterwards is normal).
// Then: Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone > Deploy, and copy the Web app URL.
// To change anything later: edit, Save, then Deploy > Manage deployments > pencil > Version: New version > Deploy (the web address stays the same).
//
// What it does: it adds one row per application to the Weekly tab, sends the weekly report email, and saves the documents into private Drive folders.
// The tool never sends an email address. It only says "weekly" or "test", and THIS script picks who gets it, so the secret cannot be used
// to send mail to anyone else.
// ===== FILL IN THESE LINES (and nothing else) =====
const SECRET = 'CHANGE: invent a long random secret, and put the same one in GitHub as SHEET_SECRET';
const MANAGER_EMAIL = '';        // CHANGE: who gets the weekly report. Several addresses are allowed, separated by commas inside the quotes.
const MY_EMAIL = '';             // CHANGE: your own address (test emails come ONLY here; you also get a copy of the weekly report)
const VIEWERS = [];              // CHANGE: Google emails allowed to OPEN the PDF folders, in quotes, separated by commas, e.g. ['a@gmail.com', 'b@gmail.com']
const SENDER_NAME = '';          // CHANGE: the name shown as the sender of the email, e.g. 'Alex Sharma'
// ===== end of the lines to fill in =====
const COPY_ME_ON_WEEKLY = true;  // change to false if you do not want a copy of the weekly report

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) return out({ ok: false, error: 'wrong secret' });
    if (data.action === 'email') return sendReport(data);
    if (data.action === 'saveFile') return saveFile(data);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('Weekly');
    if (!sh) {
      sh = ss.insertSheet('Weekly');
      sh.appendRow(['Checked on', 'Application', 'Mark', 'Class', 'Status', 'Sub status', 'Changed since last time', 'New items']);
      sh.setFrozenRows(1);
    }
    (data.rows || []).forEach((r) => sh.appendRow([r.checkedOn, r.application, r.mark, r.klass, r.status, r.subStatus, r.changed, r.newItems]));
    if (data.summary) {
      let s = ss.getSheetByName('Summary') || ss.insertSheet('Summary');
      s.appendRow([data.rows && data.rows[0] ? data.rows[0].checkedOn : '', data.summary]);
    }
    return out({ ok: true, rows: (data.rows || []).length });
  } catch (err) { return out({ ok: false, error: String(err) }); }
}

// The email carries the placeholder {{SHEET_LINK}}; it is replaced here with this spreadsheet's own address, so no link has to be set up anywhere.
function withLink(t) { return String(t || '').replace(/\{\{SHEET_LINK\}\}/g, SpreadsheetApp.getActiveSpreadsheet().getUrl()); }

// kind 'weekly' goes to the manager (copy to you); kind 'test' goes to you only. A subject that starts with [TEST] can never go to the manager.
function sendReport(data) {
  const subject = String(data.subject || '').slice(0, 200);
  if (!subject || !data.html) return out({ ok: false, error: 'empty email' });
  const isTest = data.kind === 'test' || /^\[TEST\]/.test(subject);
  if (isTest) {
    if (!MY_EMAIL) return out({ ok: false, error: 'MY_EMAIL is empty in the script' });
    MailApp.sendEmail({ to: MY_EMAIL, subject, htmlBody: withLink(data.html), body: withLink(data.text), name: SENDER_NAME });
    return out({ ok: true, emailed: true, to: 'you only' });
  }
  if (!MANAGER_EMAIL) return out({ ok: false, error: 'MANAGER_EMAIL is empty in the script' });
  const mail = { to: MANAGER_EMAIL, subject, htmlBody: withLink(data.html), body: withLink(data.text), name: SENDER_NAME };
  if (COPY_ME_ON_WEEKLY && MY_EMAIL) mail.cc = MY_EMAIL;
  MailApp.sendEmail(mail);
  return out({ ok: true, emailed: true, to: 'manager' });
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ------------------------------------------------------------------ Drive: saving the documents ----
// Files are saved in this Google account's Drive under  TM Weekly / <application> /  and the folders are PRIVATE: only the addresses in VIEWERS can open
// them (they must sign in to Google with that address). With VIEWERS empty, only this account can open them.
const ROOT_FOLDER_NAME = 'TM Weekly';

function folderIn(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// Makes sure the folder is private and viewable by exactly the people in VIEWERS (those already added are left alone).
function shareWithViewers(folder) {
  folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  const have = folder.getViewers().map((u) => u.getEmail().toLowerCase());
  VIEWERS.forEach((v) => { const e = String(v).trim().toLowerCase(); if (e && have.indexOf(e) < 0) folder.addViewer(e); });
  return VIEWERS.length;
}

// data: { app, appLabel, name, mime, base64 }. Saves one file (a file with the same name is not saved twice) and answers with its link.
function saveFile(data) {
  const clean = (t, n) => String(t || '').replace(/[\\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const app = clean(data.app, 20);
  const label = clean(data.appLabel || data.app, 80);
  const name = clean(data.name, 150);
  if (!app || !name || !data.base64) return out({ ok: false, error: 'empty file' });
  const root = folderIn(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  const sharedWith = shareWithViewers(root);   // the folders inside inherit this
  const folder = folderIn(root, label);
  const same = folder.getFilesByName(name);
  const file = same.hasNext() ? same.next() : folder.createFile(Utilities.newBlob(Utilities.base64Decode(data.base64), data.mime || 'application/pdf', name));
  return out({ ok: true, saved: true, fileId: file.getId(), url: file.getUrl(), folderUrl: folder.getUrl(), rootUrl: root.getUrl(), bytes: file.getSize(), sharedWith });
}
