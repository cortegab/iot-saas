/** Wi-Fi signal strength in words, from the RSSI a device reports (dBm), so
 * a person who doesn't know dBm still reads how good it is. The dBm stays
 * alongside for whoever does. Bands follow the usual Wi-Fi guidance: past
 * -70 dBm a link starts to drop messages, past -80 it barely holds. */
export function signalWords(rssi: number): string {
  if (rssi >= -60) return "Strong";
  if (rssi >= -70) return "Good";
  if (rssi >= -80) return "Weak";
  return "Very weak";
}

/** "Good (-63 dBm)" */
export function signalLabel(rssi: number): string {
  return `${signalWords(rssi)} (${rssi} dBm)`;
}
