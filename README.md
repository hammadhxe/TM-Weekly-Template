# Trademark Weekly Tracker

Checks your trademark applications on the Indian Trade Marks e-Register (IP India) every Monday morning, by itself.

**What it does each week**
- Logs in to the e-Register (it reads the one-time login code from a dedicated mailbox).
- Reads each application's status, reminders, notices and uploaded documents.
- Compares them with last week and finds what is new.
- Adds a row per application to a Google Sheet.
- Saves every notice and document as a PDF in a private Google Drive folder (one folder per application).
- Emails a formatted weekly report (what changed, new PDFs with links) to the people you choose.
- Sends the owner a Telegram summary, or an alert if a run fails.

**What it never does**
- It never changes anything on the government site. It only reads.
- It never claims "no change" about something it could not check. It says so plainly instead.

It runs on free tools (GitHub, Google, Telegram). There is no server to look after.

> **Important: keep your own copy of this repository PRIVATE.** The tool saves your applications' details in the repository every week. A public copy would publish them.

**To set it up, follow [SETUP.md](SETUP.md).** It is written for people who do not code, and takes about 1 to 2 hours the first time.

**Good to know**
- Use your own accounts. Never share your passwords, tokens or secret words with anyone.
- Keep the GitHub repository **private**: it stores your application details.
- Automated access to a website is your responsibility. This tool only reads, one request at a time, with pauses. Check the site's terms for your own use.
- It does not read the text inside notices (for example hearing dates). It tells you a notice exists and links the PDF.
- If the e-Register changes its layout the tool can stop working. You will get a Telegram alert saying so.

## Disclaimer
This is an independent tool. It is not made by, endorsed by, or connected with IP India or the Controller General of Patents, Designs and Trade Marks. It is provided "as is", with no warranty of any kind. You are responsible for how you use it and for following the terms of the website it reads. It is not legal advice: for anything that matters, check the official register yourself.

## License
MIT License. See the [LICENSE](LICENSE) file. Copyright (c) 2026 Hammad Altaf Hafiz.
