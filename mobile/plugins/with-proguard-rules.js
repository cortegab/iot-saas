// Keep rules for the release build's R8 minifier (android/ is regenerated on
// every build, so they go in through this plugin, not by hand).
//
// Two libraries find code by name at run time, which R8 renames or removes:
// - expo-camera turns barcode scanning on only if
//   Class.forName("com.google.mlkit.vision.barcode.BarcodeScanning") succeeds
//   (CameraUtils.isMLKitBarcodeScannerAvailable), and ML Kit builds its
//   component registrars by reflection (no-arg constructors). Either one
//   stripped and the scanner shows the camera but never reads a code (0.4.0,
//   0.4.1; found with adb logcat on a Redmi Note 12S).
// - The ESP provisioning module hears "connected" through EventBus, which finds
//   @Subscribe methods by reflection. Its handler survives today (checked in
//   0.4.0 with dexdump), but nothing guaranteed it: EventBus's own rules pin it.
const { withDangerousMod, withGradleProperties } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARK = "# --- IO Driven keep rules (plugins/with-proguard-rules.js) ---";
const RULES = `
${MARK}
-keep class com.google.mlkit.vision.barcode.BarcodeScanning { *; }
-keepnames class com.google.mlkit.vision.barcode.** { *; }
# ML Kit creates its component registrars by reflection through their
# no-argument constructors (ComponentDiscovery). Stripped, the barcode scanner
# never initialises: "Could not instantiate ...BarcodeRegistrar: <init> []".
-keep class com.google.mlkit.** implements com.google.firebase.components.ComponentRegistrar { <init>(); }
-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }
-keep class com.google.mlkit.**.internal.*Registrar { <init>(); *; }
-keepattributes *Annotation*
-keepclassmembers class * {
    @org.greenrobot.eventbus.Subscribe <methods>;
}
-keep enum org.greenrobot.eventbus.ThreadMode { *; }
-keep class com.espidfprovisioning.** { *; }
`;

module.exports = function withProguardRules(config) {
  // MINIFY=0 builds a release without R8, to tell a minifier problem from
  // anything else (MINIFY=0 pnpm build:apk).
  if (process.env.MINIFY === "0") {
    config = withGradleProperties(config, (cfg) => {
      cfg.modResults = cfg.modResults.filter((p) => !(p.type === "property" && p.key === "android.enableMinifyInReleaseBuilds"));
      cfg.modResults.push({ type: "property", key: "android.enableMinifyInReleaseBuilds", value: "false" });
      return cfg;
    });
  }
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
      const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (!current.includes(MARK)) fs.writeFileSync(file, current + RULES);
      return cfg;
    },
  ]);
};
