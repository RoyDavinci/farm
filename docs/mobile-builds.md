# Phone builds (Expo EAS)

The app is ready for EAS builds:

- **Build profiles** are in `apps/mobile/eas.json`:
  - `development`: a dev client for live-reload testing on a phone
  - `preview`: an installable test build pointed at staging
  - `production`: store builds
- **App config** in `apps/mobile/app.json` has the icon, adaptive icon, splash screen, notification icon, camera/photo/location permission texts and iOS export compliance, and passes `expo-doctor`.

These steps need your accounts, so they're yours to run.

## 1. Link the project to Expo (once)

```bash
cd apps/mobile
```

```bash
npx eas-cli@latest login
```

```bash
npx eas-cli@latest init
```

`eas init` creates the project on expo.dev and writes its ID into `app.json` (`extra.eas.projectId`). Commit that change. **Push notifications start working only after this**, because the app needs the project ID to get a push token.

## 2. Android test build (no store account needed)

```bash
npx eas-cli@latest build --platform android --profile preview
```

EAS creates the Android signing key the first time. When the build finishes, open its link on an Android phone and install the APK. It talks to the AWS test environment (`EXPO_PUBLIC_API_URL` in the `preview` profile: `https://api.35-177-195-6.sslip.io/v1`, see [test environment](deploy-aws-test.md)).

**Push on Android needs Firebase:**

1. In the Firebase console, create a project and add an Android app with package `ng.zuru.app`.
2. Download `google-services.json` and upload it with `npx eas-cli@latest credentials` (Android → Google Service Account / FCM V1).

Without Firebase, the app works but receives no pushes.

## 3. iPhone test build (needs an Apple Developer account, $99/year)

```bash
npx eas-cli@latest device:create
```

```bash
npx eas-cli@latest build --platform ios --profile preview
```

`device:create` registers each test iPhone; open the link it shows on that phone. EAS manages the certificates and the push key when you sign in with your Apple account. Install the build from its link on a registered iPhone.

## 4. Development builds (live reload on a real phone)

```bash
npx eas-cli@latest build --platform android --profile development
```

```bash
npm run dev:mobile
```

Install the development build, then open the project from it while `npm run dev:mobile` is running. It reads `EXPO_PUBLIC_API_URL` from `apps/mobile/.env`. Use your computer's LAN address there, not `localhost`.

## 5. Store releases (later)

- Replace the `production` profile's placeholder API URL with the production API.
- Run:
  ```bash
  npx eas-cli@latest build --platform all --profile production
  ```
  then
  ```bash
  npx eas-cli@latest submit --platform all
  ```
- Store listings, screenshots, a privacy policy URL and the data-safety forms are needed in App Store Connect and Google Play Console.

## What to test on a phone (not possible on the web preview)

- **Push:** a booking request reaches the seller with the app closed, and tapping it opens Bookings.
- **Camera:** taking listing photos, and scanning the driver's or buyer's QR handover code during a delivery.
- **Location:** "Use my location" in the Market, and the driver going online.
- **Offline:** turn on flight mode, and Bookings and Wallet still show the last saved data.
