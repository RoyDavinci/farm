// Extends app.json with build-time settings that must not live in the public repository.
//
// Firebase (Android push via FCM): google-services.json is git-ignored. Expo's cloud builds get it
// from the EAS file variable GOOGLE_SERVICES_JSON; local builds use apps/mobile/google-services.json.
// Pointing android.googleServicesFile at it makes Expo add the Google Services Gradle plugin.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

module.exports = ({ config }) => {
  const local = join(__dirname, 'google-services.json');
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON || (existsSync(local) ? './google-services.json' : undefined);
  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
