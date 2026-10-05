# Releasing Kadam

Step-by-step checklist for publishing **Kadam: Habit Tracker** (`com.hamzaameer.kadam`) to Google Play and the App Store with EAS. Store text, icons and screenshots are in [`store-assets/`](./store-assets/) (see [`store-assets/listing.md`](./store-assets/listing.md)).

EAS CLI isn't a project dependency; run it as `npx eas-cli@latest <command>` (written `eas` below).

---

## 0. Before the first build

1. **Link the EAS project to the `kadam` slug.** `eas project:info` must show `@xitas/kadam` without errors. If it says *"Slug for project identified by extra.eas.projectId (habit-tracker) does not match the slug field (kadam)"*:
   - delete `extra.eas.projectId` from `app.json`, then run `eas init` and choose to create `@xitas/kadam`; it writes the new project ID into `app.json`. Commit that change.
2. Check the version in `app.json` (`"version": "1.0.0"`). Build numbers (`versionCode` / `buildNumber`) are managed by EAS (`"appVersionSource": "remote"`) and go up automatically for every production build.
3. Run the checks: `npm test`, `npm run typecheck`, `npm run lint`, `npx expo-doctor`.

## 1. Build the production AAB and IPA

```bash
eas build --profile production --platform android   # .aab for Google Play
eas build --profile production --platform ios       # .ipa for the App Store
# or both at once:
eas build --profile production --platform all
```

- **Android signing:** on the first build, let EAS generate the keystore ("Generate new keystore"). This becomes the **upload key**. EAS keeps it; download a backup with `eas credentials --platform android` and store it somewhere safe and private (never in this repo).
- **iOS signing:** EAS asks you to log in with your Apple Developer account, registers the bundle ID and creates the certificate and provisioning profile.
- **Check the Android permissions** of the finished build: in Play Console → *Test and release → App bundle explorer* → the bundle → *Permissions*. Release builds should list only `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` and `VIBRATE` (plus `com.hamzaameer.kadam.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, an internal permission AndroidX defines for the app itself). INTERNET is removed from release builds by `plugins/withReleaseBlockedPermissions.js`; the others by `android.blockedPermissions` in `app.json`.

A **preview** build (`eas build --profile preview --platform android`) is a release APK you can install directly on a phone for testing.

## 2. Google Play

### 2.1 Create the app

1. [Play Console](https://play.google.com/console) → **Create app**. Name *Kadam: Habit Tracker*, default language, **App**, **Free**, accept the declarations.
2. Complete **Dashboard → Set up your app** (answers are in `store-assets/listing.md`):
   - **Privacy policy:** `https://xitas.github.io/habit-tracker/privacy.html` (GitHub Pages must be on; see the README).
   - **App access:** all functionality available without special access.
   - **Ads:** no ads.
   - **Content rating:** IARC questionnaire, category *All other app types*, all answers *No* → Everyone.
   - **Target audience:** 13 and over.
   - **Data safety:** *Does your app collect or share any of the required user data types?* → **No**.
   - **Government apps / financial features / health:** not applicable. In the health apps declaration, Kadam has no health features (it's a general habit tracker that gives no health information).
3. **Store listing:** short and full description, the 512 px icon, the feature graphic, and the phone screenshots from `store-assets/screenshots/android/`. Category **Productivity**, contact email.

### 2.2 Internal testing (your own devices, available within minutes)

1. **Test and release → Testing → Internal testing → Create new release.**
2. On the first release, accept **Play App Signing** (Google holds the app signing key; your EAS keystore is the upload key).
3. **Upload the first AAB manually** (download it from the EAS build page). The Google Play API used by `eas submit` only works after one manual upload.
4. Add testers (an email list), save, review, roll out. Testers open the opt-in link and install from Play.

### 2.3 Closed testing (required for new personal accounts)

Personal developer accounts created after 13 November 2023 must run a **closed test with at least 12 testers who stay opted in for at least 14 days in a row** before they can apply for production. Testers who opt out before 14 days don't count.

1. **Testing → Closed testing → Create track** (or use *Alpha*), add a release (promote the internal one or upload a new AAB).
2. Add at least **12 testers** (email list or Google Group). Ask them to opt in via the link, install, and keep the app for 14+ days. Recruit a few extra in case some drop out.
3. Fix what they report; upload new builds to the same track as needed (the 14 days don't restart).
4. After 14 days with 12+ opted-in testers, **Dashboard → Apply for production** and answer the questions about your closed test, the app and production readiness. Google's review usually takes up to 7 days.

### 2.4 Production

1. Once production access is granted: **Production → Create new release** → *Add from library* (promote the tested build) → release notes from `listing.md` → **Review release → Start rollout**. A staged rollout (e.g. 20%) is a good idea for the first release.
2. The first review of a new app can take several days.

## 3. App Store

### 3.1 Set up

1. Enroll in the **Apple Developer Program** (paid yearly).
2. **App Store Connect → Apps → + → New App:** platform iOS, name *Kadam: Habit Tracker*, primary language, bundle ID `com.hamzaameer.kadam` (appears after the first EAS build or after registering it in the developer portal), SKU e.g. `kadam-ios`, full access.
3. **App Information:** subtitle, category **Productivity** (secondary: Health & Fitness), content rights (no third-party content), age rating questionnaire (all *None/No* → 4+).
4. **App Privacy:** privacy policy URL, then *Data Not Collected*.
5. **Pricing and Availability:** free, choose countries.
6. **Version 1.0.0 page:** screenshots from `store-assets/screenshots/ios/` (6.9" display), promotional text, description, keywords, support URL (e.g. the GitHub repo), copyright `2026 Hamza Ameer`.

### 3.2 TestFlight

1. Upload the IPA: `eas submit --platform ios` (see section 4), or build with `--auto-submit`.
2. The build appears in **TestFlight** after processing (usually 10–15 minutes). Answer the export compliance question if asked (Kadam uses no non-exempt encryption; `app.json` already declares this).
3. Add yourself and others as **internal testers** (instant) or create an **external** group (needs a short Beta App Review). Install with the TestFlight app.

### 3.3 Submit for review

1. On the 1.0.0 version page, select the tested build.
2. **App Review Information:** contact details; sign-in **not required**. Notes for the reviewer, for example: *"Kadam works fully offline with no account. Create a habit with the + button on Today. Reminders are local notifications."*
3. **Add for Review → Submit.** Reviews usually take one to three days. Choose manual or automatic release after approval.

## 4. `eas submit` setup

### Android

1. In Google Cloud, create a **service account** for your Play Console developer account, create a JSON key, and in Play Console → *Users and permissions* invite the service account with release permissions for Kadam ([Expo guide](https://expo.fyi/creating-google-service-account)).
2. Upload the key to EAS (recommended, so it never sits in the repo): `eas credentials --platform android` → *Google Service Account* → upload. Or keep it outside the repo and set `serviceAccountKeyPath`. Key files are already in `.gitignore`.
3. `eas.json` already has `submit.production.android` with `track: "internal"` and `releaseStatus: "draft"`; change the track (`internal`, `alpha`, `beta`, `production`) as you move along.
4. After the first manual upload: `eas submit --platform android --latest` (or `eas build --profile production --platform android --auto-submit`).

### iOS

1. Run `eas credentials --platform ios` → production → set up an **App Store Connect API key** (EAS can create it for you).
2. Add the app's Apple ID (App Store Connect → App Information → *Apple ID*, a number) to `eas.json`:
   ```json
   "submit": { "production": { "ios": { "ascAppId": "1234567890" } } }
   ```
3. `eas submit --platform ios --latest`. The build lands in TestFlight; submit it for review in App Store Connect (section 3.3).

## 5. Pre-release tests on real devices

Test the **preview** APK (Android) and the **TestFlight** build (iPhone), ideally on one older and one recent phone.

**Fresh install**
- [ ] Uninstall any older build first. The app opens on an empty Today with the starter suggestions; no crash with no data.
- [ ] Create a yes/no habit, a measurable habit and a "3× per week" habit; complete, skip, undo.
- [ ] Airplane mode on: everything still works (Kadam never needs the internet).

**Reminders**
- [ ] Turning reminders on shows the explanation, then the system prompt; "Not now" doesn't show the system prompt.
- [ ] A habit reminder arrives at its time (allow a few minutes on Android) and opens that habit when tapped; the evening nudge opens Today.
- [ ] Completing a habit before its time cancels that day's reminder.
- [ ] Restart the phone: reminders still arrive.
- [ ] Notification icon shows the white stairs symbol; Settings → Notifications shows the "Habit reminders" channel under Kadam.

**Backup, restore and files** (Android without storage permissions)
- [ ] Back up data → save to Drive/Files; "Last backup: today" appears.
- [ ] Change something, Restore from backup → summary → Restore; the change is gone; Undo works.
- [ ] Export data as CSV → open the file; Import CSV (add and replace) shows the preview.
- [ ] Reset all data → "Back up first" works, then reset.

**Appearance and accessibility**
- [ ] Light, dark and System theme; switch the phone's dark mode with the app open.
- [ ] Largest text size (Android: Settings → Display → Font size; iPhone: Settings → Accessibility → Display & Text Size → Larger Text): nothing clipped or overlapping on a small phone.
- [ ] TalkBack / VoiceOver: cards, calendar days and buttons are read sensibly; Complete/Skip actions work.
- [ ] Reduce motion on: no confetti, a still "All done for today" badge.
- [ ] App icon, round icon, themed icon (Android 13+), splash screen in light and dark.

**Upgrade (data must survive)**
- [ ] Android: install preview build A, add data, then install a newer preview build B over it (same EAS keystore) → data, settings and reminders are still there.
- [ ] Through the store: install from the internal testing track, add data, publish a higher build to the same track and update from Play → data kept. (A Play-installed app can't be updated with a sideloaded APK and vice versa: Play re-signs apps with its own key.)
- [ ] iPhone: install a TestFlight build, add data, install a newer TestFlight build → data kept.

**Store listing**
- [ ] Screenshots match the current app; privacy policy URL opens; listing text has no typos.
