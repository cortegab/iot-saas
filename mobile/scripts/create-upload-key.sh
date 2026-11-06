#!/usr/bin/env bash
#
# create-upload-key.sh: create the Play Store upload key for the iodriven app,
# once, on your machine. Writes mobile/credentials/ (git-ignored):
#   upload.keystore         the key (keep a backup: losing it means asking
#                           Google to reset the upload key)
#   upload-key.properties   where it is and its password, read by release builds
# The password is generated here and never printed; back up both files
# together (a password manager's file attachment works).

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DIR=credentials
[ -e "$DIR/upload.keystore" ] && { echo "$DIR/upload.keystore already exists; not replacing it."; exit 1; }
command -v keytool >/dev/null || { echo "keytool not found: install JDK 17 and set JAVA_HOME (mobile/README.md)."; exit 1; }

umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"
PASS=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 32)

keytool -genkeypair -v -storetype PKCS12 \
  -keystore "$DIR/upload.keystore" -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=iodriven, O=iodriven" >/dev/null 2>&1

cat > "$DIR/upload-key.properties" <<PROPS
storeFile=upload.keystore
storePassword=$PASS
keyAlias=upload
keyPassword=$PASS
PROPS

echo "Created $DIR/upload.keystore and $DIR/upload-key.properties."
echo "Back up both files now; release builds (pnpm build:apk / build:aab) sign with them from here on."
