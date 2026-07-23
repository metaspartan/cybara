const { withAndroidManifest } = require("expo/config-plugins");

const LAN_PERMISSIONS = [
  {
    $: {
      "android:name": "android.permission.NEARBY_WIFI_DEVICES",
      "android:maxSdkVersion": "36",
      "android:usesPermissionFlags": "neverForLocation",
    },
  },
  {
    $: {
      "android:name": "android.permission.ACCESS_LOCAL_NETWORK",
    },
  },
];

function addPermission(manifest, permission) {
  const permissions = manifest.manifest["uses-permission"] || [];
  const name = permission.$["android:name"];
  const existing = permissions.find((entry) => entry?.$?.["android:name"] === name);
  if (existing) {
    existing.$ = { ...existing.$, ...permission.$ };
  } else {
    permissions.push(permission);
  }
  manifest.manifest["uses-permission"] = permissions;
}

function applyAndroidLanCleartext(manifest) {
  const application = manifest.manifest.application?.[0];
  if (!application) {
    throw new Error("AndroidManifest.xml is missing its application element");
  }
  application.$["android:usesCleartextTraffic"] = "true";
  for (const permission of LAN_PERMISSIONS) addPermission(manifest, permission);
  return manifest;
}

function withAndroidLanCleartext(config) {
  return withAndroidManifest(config, (next) => {
    next.modResults = applyAndroidLanCleartext(next.modResults);
    return next;
  });
}

module.exports = withAndroidLanCleartext;
module.exports.applyAndroidLanCleartext = applyAndroidLanCleartext;
