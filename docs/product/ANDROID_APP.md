# Android app: behaviour and auto-capture

What the APK does differently from the web app, and how to set up and check bank-message
auto-capture. To get the APK onto a phone see [Installing a build](../deployment/BUILD.md#installing-a-build);
for the design behind these features see [LLD §6](../architecture/LLD.md#6-android-native-layer) and
[Feature 020](FEATURES.md#feature-020-android-fingerprint-unlock-editable-review--auto-capture).

## What is different on Android

- **Export and Backup** open Android's share sheet (Save to Drive, Files, send to another app, …)
  instead of downloading to a folder. The file is first written to the app's private cache. If you
  dismiss the sheet, MyFin reports "Save cancelled." and no file was saved.
- **Data stays on the device.** The app disables Android's cloud auto-backup
  (`android:allowBackup="false"`) so your encrypted ledger and session key are never uploaded to a
  Google account. Moving to a new phone therefore works through MyFin's own encrypted Backup →
  Restore, not through Android's phone-to-phone transfer.
- **Fingerprint unlock** works through Android's own fingerprint prompt (the browser's WebAuthn is not
  available inside Android WebView). Turn it on from **Security** in the menu (or from the offer after
  you unlock with your PIN). The PIN still works and is still what protects your data: the fingerprint
  only fetches a key that unlocks your PIN on this phone. The lock screen opens the fingerprint prompt
  by itself when you come back to the app after being away longer than your **auto-lock** time (default
  5 minutes; change it under **Security**); coming back sooner does not ask again. Adding or removing a
  fingerprint in Android settings switches MyFin's fingerprint unlock off on purpose: enter your PIN and
  turn it on again. It needs a fingerprint sensor (or face unlock) that Android rates as _strong_; some
  face unlock is rated weaker and will be reported as unavailable.
- **Share into MyFin**: MyFin appears in Android's share sheet. Share a bank SMS (text) from your
  messages app and it opens **Quick Add** with the message parsed; share a receipt photo and it opens
  **New Transaction** with the image attached; share a bank statement downloaded as **CSV or Excel** and
  it opens **Import** with the file loaded for column mapping. A share made while MyFin is locked waits
  and opens after you unlock. Images and statements over 10 MB are refused with a message. If you are
  partway through typing a transaction, MyFin asks before a share replaces it (and offers to open the
  share later if you decline).
- **Reminders are real Android notifications**: bill reminders, budget alerts and overdue-loan
  reminders appear as Android notifications (the browser's notification API does not exist inside the
  app). MyFin asks once (Android 13+ shows the system permission dialog), and they are shown when you
  unlock the app, not on a schedule while it is closed — nothing financial is handed to Android's alarm
  scheduler to be stored and fired later. They appear under the channel **Bill and budget reminders**
  (hidden on the lock screen). Each one is also listed under **Alerts** in the menu (with an unread
  count), whether or not notifications are allowed, and tapping the notification opens the matching
  screen.
- **Automatic backups to a folder**: under **Backup → Automatic backups**, **Choose backup folder**
  opens Android's folder picker (Storage Access Framework — no storage permission is needed, and MyFin
  can only touch the one folder you pick). Choose a folder that Google Drive, Syncthing or similar
  already watches, and each scheduled backup (checked every time you unlock with your PIN — the backup
  is encrypted with it) leaves the phone as a new encrypted `myfin-auto-backup-YYYY-MM-DD.json` file.
  Old files are not deleted. If Android revokes the folder, the next run is recorded as failed and the
  page says so. **Remind me weekly** additionally schedules a notification with fixed text (no
  financial details) so a missed backup does not go unnoticed; it is the one notification MyFin hands
  to Android's scheduler.
- **In-app updates** (**About → App updates**): MyFin looks up the newest release of its own
  repository on GitHub, downloads `MyFin-vX.Y.Z.apk`, checks it (size, GitHub's SHA-256, that it is
  MyFin, that it is newer, that it is signed with the installed app's key) and hands it to Android's
  installer. It only happens when you press the buttons — there is no background checking. The request
  is made by the app's native code, not the web page, to `api.github.com` and the release download of
  this one repository; GitHub sees your IP address and a generic `MyFin-Android-Updater` name, nothing
  from your data. The page itself still cannot make network requests. Android shows its own
  confirmation, and asks once to allow MyFin to **install unknown apps** (the
  `REQUEST_INSTALL_PACKAGES` permission). Google Play Protect may still warn about a file-based app that
  reads SMS; choose **Install anyway**.
- **Not available in the APK** (they rely on browser features; MyFin hides or skips them): the PWA
  update prompt (replaced by **App updates** above) and the "browser couldn't guarantee protected
  storage" banner. Take regular Backups.
- The hardware/gesture **Back** button follows the app: it first closes an open dialog or the
  navigation drawer, then steps back through MyFin's pages, and from the Dashboard leaves the app.
- **Lock when I leave the app** (Security → Auto-lock) locks MyFin once it has been out of the
  foreground for more than 30 seconds, whatever the auto-lock time.

## Auto-capture of bank messages

MyFin can add bank transactions to your **Review** queue by itself: it reads incoming bank SMS, and
notifications from payment and banking apps (Google Pay, PhonePe, Paytm, BHIM, CRED and the HDFC, ICICI,
SBI, Axis and Kotak apps). It is off until you turn it on under **Auto-capture** in the menu (the page
only exists in the APK).

1. **Add the last digits of each account** under Accounts (for example `1234`, from "A/c XX1234" in
   your bank's messages). Messages are filed under the account whose digits they name; anything else
   goes to the **default account** you choose.
2. Open **Auto-capture** and: allow **Read incoming SMS**, switch on **Notification access** for MyFin
   in Android's list, and allow the **alert** (Android 13+). Pick the default account and **Turn on
   auto-capture**. MyFin first locks and unlocks a test message to prove the phone and the app agree
   before it captures anything.
3. New transactions then appear in Review with an **SMS** or **Notification** badge, the original
   message under **Original message**, and **Edit** if the amount, account, merchant or date need
   fixing. One payment seen as both an SMS and an app notification becomes one entry. Entries on a
   guessed account say **Account not matched — check**.

**What is and is not read.** Only SMS that look like completed money movements are kept; one-time
codes, offers, balance alerts, failed payments and bill reminders are discarded without being stored. A
text from a phone number is kept only if it reads like a bank alert (a currency amount plus the account
or card digits, like "INR 97.00 debited A/c no. XX0146"), so a bank alert forwarded by a friend still
files, but "I paid you Rs 500" does not. Notifications are read only from the payment/banking and
messaging apps listed in `CaptureFilter.java` (package names change between app versions — check with
`adb shell pm list packages`; an app missing from the list is simply not captured from). A messaging
app's notification (Google Messages, Samsung Messages) is the only way MyFin sees a bank alert that
arrives over RCS rather than as an SMS; its text is looked at in memory and kept only if it reads like a
bank alert, and the same alert seen as both SMS and notification becomes one entry. MyFin never reads
your SMS inbox (it only holds the receive permission), never logs message text, and nothing leaves the
phone.

**Locked or closed.** Messages that arrive while MyFin is closed or locked are locked away on arrival
with a public key; the matching private key is stored encrypted with your PIN-derived key, so nothing
readable is kept. They are opened and filed the next time you unlock. The alert only says how many are
waiting.

**If Android blocks it.** An app installed from a file is treated as risky for SMS and notification
access. If the permission is refused, or the "Notification access" switch is greyed out: open **App
info** for MyFin, tap the **⋮ menu**, choose **Allow restricted settings**, then try again (the menu
only appears after one blocked attempt). The Auto-capture page has buttons for both screens. Google Play
Protect may also warn about, or refuse, installing a file-based app that asks for SMS or notification
access; **Install anyway** works, and `adb install` is the fallback. If a phone's battery saver stops
MyFin, allow it to run in the background, or messages arrive late or not at all. Receivers only start
working after MyFin has been opened once following an install or a Force stop.

### Checking auto-capture on a phone

`adb emu sms send VM-HDFCBK "Rs.250.00 debited from A/c XX1234 to SWIGGY on 05-10-26 Ref 628123456789"`
sends a test SMS to an emulator. On a real phone, use a real bank message, or text yourself a
bank-style message from another number that includes a currency amount and `A/c XX1234` (a bare "paid
500" is ignored on purpose). With **Notification access** on, the message is also picked up from your
messages app's notification, so it works even when it arrives over RCS. If nothing appears, check that
the account's last digits are saved under Accounts (otherwise it files under the default account and
says **Account not matched — check**) and open MyFin once so it can file what it caught.
