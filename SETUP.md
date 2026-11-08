# Setup guide (for people who do not code)

**Keep your copy of this repository PRIVATE.** The tool saves your applications' details into it every week, so a public copy would publish them.

Take your time and do the parts in order. If a screen looks different from what is written here, stop and ask for help instead of guessing.

## What you need
- A free **GitHub** account.
- A **new Google account used only for this** (it receives the login codes, owns the sheet, and holds the PDFs). Do not use your personal one.
- **Telegram** on your phone.
- Your **application numbers**.
- The **email addresses** of who should get the weekly report, and who may open the PDF folders (they must be Google accounts).

---
## Part 1. The accounts

### 1. GitHub: your own private copy
1. Sign in at github.com and click **New repository**. Name it `tm-weekly`. Choose **Private**. Create it.
2. Click **uploading an existing file**. Drag in **everything** from this kit, including the folders `.github` and `tm_weekly`. Click **Commit changes**.
3. Click **Actions**. You should see a workflow called **TM weekly**. If you do not, the `.github` folder was not uploaded: upload it again.

### 2. The Gmail that receives the login codes
1. Sign in to the new Google account. Open Google Account, then **Security**, and turn on **2-Step Verification** (with your phone number).
2. Open **myaccount.google.com/apppasswords** (type it straight into the address bar; the menu often hides it). Create an app password called `tmcheck`.
3. Copy the 16 letters. Keep them safe. Google shows them only once.
4. If that page says "not available": sign in with only this one account in a private window, and make sure 2-Step Verification uses a phone number, not only a security key.

### 3. The Telegram bot (for the weekly summary and alerts)
1. In Telegram, open **@BotFather** and send `/newbot`. Choose a name and a username ending in `bot`.
2. BotFather gives you a long **token**. Copy it.
3. Open your new bot and send it any message, such as `hi`.

### 4. The Google Sheet and its script
Work in a **private window** with only the new Google account signed in. (With several accounts signed in, Google often opens the wrong one and says "unable to open the file".)
1. Create a new Google Sheet called `Trademark Tracker`.
2. Click **Extensions, then Apps Script**. Delete all the code. Open the file `google_sheet_script.gs` from this kit, copy everything, and paste it in.
3. Fill in the lines between the two `=====` marks, keeping the quote marks:
   - `SECRET`: invent a long random secret (30 or more letters and numbers). Write it down. You need it again in step 6.
   - `MANAGER_EMAIL`: who gets the weekly report (several addresses are allowed, separated by commas).
   - `MY_EMAIL`: your own address.
   - `VIEWERS`: the Google emails allowed to open the PDF folders, like `['a@gmail.com', 'b@gmail.com']`.
   - `SENDER_NAME`: the name shown as the sender, like `Alex Sharma`.
4. Press **Ctrl+S**. In the dropdown at the top choose **saveFile** and click **Run**. Google asks for permission to use Drive and to send email: click **Review permissions**, choose the account, then **Advanced**, then **Go to (project)**, then **Allow**. A red error afterwards is normal.
5. Click **Deploy, then New deployment**. Click the gear and choose **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy** and copy the **Web app URL**.
6. Later, if you ever change the script: Save, then **Deploy, Manage deployments, the pencil, Version: New version, Deploy**. Never choose "New deployment" again: it would change the web address.

---
## Part 2. Tell GitHub the secrets
In your repository open **Settings, then Secrets and variables, then Actions, then New repository secret**. Add the secrets below **one at a time**: type only the name in the Name box, and paste only the value in the Secret box.

| Name | What to paste |
|---|---|
| `LOGIN_EMAIL` | the new Gmail address from step 2 |
| `GMAIL_APP_PASSWORD` | the 16 letters from step 2 (spaces do not matter) |
| `TELEGRAM_BOT_TOKEN` | the token from step 3 |
| `SHEET_URL` | the Web app URL from step 4 |
| `SHEET_SECRET` | the same secret you put in the script's `SECRET` line |
| `SIGN_NAME` | your name for the email footer (optional) |

Never send these to anyone, and never type them into a chat.

## Part 3. Your applications
In the repository click the file `apps.txt`, then the pencil. Under the comment lines, add one application number per line. Click **Commit changes**.

---
## Part 4. Test it step by step
Each test: **Actions, then TM weekly, then Run workflow**, make sure the branch is **main**, choose the mode, and click the green button. Wait for the green tick. Do them in this order:

1. **`telegram-test`**: you should get a Telegram message "Telegram test OK". This also saves your chat so alerts always reach you.
2. **`login-test`**: logs in to the e-Register by itself and tells you on Telegram. This proves the login code is read.
3. **`email-test`**: sends a sample report email to `MY_EMAIL` only (the sample has one invented line marked SAMPLE ONLY).
4. **`drive-test`**: saves one tiny test file into Drive (folder `TM Weekly`). Telegram says how many people the folders are shared with.
5. **`full`**: the real check of all your applications. **The first run also downloads every document, so it can take about 25 minutes.** If time runs out, run `full` again and it continues. It sends no email.
6. When all of this looks right, run **`full-and-email`** once. This one **really emails the recipients**.

## Part 5. Going live
Nothing more to do. It runs by itself every Monday at 10:00 India time and emails the report. To change the day or time, edit the `cron` line in `.github/workflows/tm-weekly.yml` (it is written in UTC; India is UTC+5:30).

You can still run any mode by hand at any time. `full` never emails anyone. `full-and-email` does.

---
## What the weekly email shows
- A coloured banner: green for no changes, amber for changes, red if anything could not be checked.
- **What changed**: new notices and documents with dates, with a NEW badge and an Open PDF link for important ones.
- **Could not be checked**: anything it could not read, with the last known status and date.
- **Documents not saved to Drive**: anything it could not save, with the reason.
- A table of all applications with a **View PDFs** link for each.
- A button to the full spreadsheet.

## If something goes wrong
| What you see | What it means and what to do |
|---|---|
| Telegram says "NO CHAT FOUND" | Send any message to your bot, then run `telegram-test` again. |
| "Gmail would not open" or "app password was refused" | The app password or `LOGIN_EMAIL` is wrong. Create a new app password and update the secret. |
| "The OTP email did not arrive" | The mailbox did not get the code in time. Run again. Check the mailbox's spam folder. |
| "Could not log in after 4 tries" | The site may be busy or blocking. Wait an hour and run `login-test`. |
| "The Google script is still the old version" | Deploy a new version: Deploy, Manage deployments, the pencil, New version, Deploy. |
| "wrong secret" | `SHEET_SECRET` in GitHub and `SECRET` in the script are different. Make them the same. |
| An application "could not be read" | It is tried again next run. If it keeps happening, tell whoever maintains the tool. |
| "apps.txt has no application numbers" | Add your numbers to `apps.txt`. |
| No Telegram message on a Monday | Treat that as a problem. Open the Actions tab and look at the latest run. |

## Safety rules
- Keep the repository **private**.
- If you change the secret word, change it in **both** places (the script's `SECRET` line and the GitHub `SHEET_SECRET`), then publish a new version of the script.
- The site allows one login per email at a time. If a run is stopped halfway, wait about two minutes before running again.
- GitHub's free plan has plenty of room for a weekly run of a few applications.
