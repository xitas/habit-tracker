# Contributing to Kadam

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

## Run the project

You need **Node.js 20.19.4 or newer** and npm.

```bash
git clone https://github.com/xitas/habit-tracker.git
cd habit-tracker
npm install
npm start          # then press a (Android), i (iOS) or w (web)
```

Reminders need a development build rather than Expo Go on Android: `npx expo run:android` or `npx expo run:ios`.

## Run the checks

Run these before opening a pull request. They should all pass:

```bash
npm test             # unit and storage tests
npm run typecheck    # TypeScript
npm run lint         # ESLint
```

If you change the app icon, edit `assets/icon-source/kadam-icon.svg` and run `npm run icons` to regenerate every PNG.

## Branches

Create a branch from `master` named after the kind of change:

- `feature/short-description`: new functionality
- `fix/short-description`: bug fixes
- `docs/short-description`: documentation only
- `chore/short-description`: tooling, dependencies, clean-up

## Pull requests

1. Keep each pull request focused on one change.
2. Describe what changed and why, and how you tested it (include screenshots for UI changes, in light and dark mode).
3. Make sure the checks above pass.
4. Use `npx expo install <package>` to add dependencies, so versions match the Expo SDK.
5. Don't commit secrets: signing keys, store credentials, `.env` files or API keys.

For larger changes, please open an issue first so we can agree on the approach.

## Name and icon

The code is MIT licensed, but the name "Kadam" and the Kadam icon are not. If you publish a fork, please give it a different name and icon (see the Trademark section in the [README](./README.md#trademark)).
