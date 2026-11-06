import type { ESPWifiList } from "@orbital-systems/react-native-esp-idf-provisioning";

export interface WifiNetwork {
  ssid: string;
  /** dBm; the strongest access point when a network has several. */
  rssi: number;
  open: boolean;
}

/** The networks the board can see, one row per name, strongest first. */
export function networksFrom(list: ESPWifiList[]): WifiNetwork[] {
  const best = new Map<string, WifiNetwork>();
  for (const n of list) {
    if (!n.ssid) continue; // hidden networks: "Other network"
    const prev = best.get(n.ssid);
    if (!prev || n.rssi > prev.rssi) best.set(n.ssid, { ssid: n.ssid, rssi: n.rssi, open: n.auth === 0 });
  }
  return [...best.values()].sort((a, b) => b.rssi - a.rssi);
}

/** Signal in words, as the web's Health row reads RSSI. */
export function signalLabel(rssi: number): string {
  return rssi >= -60 ? "Strong" : rssi >= -72 ? "Good" : rssi >= -82 ? "Weak" : "Very weak";
}

export type Step = "permission" | "connect" | "scan" | "provision";

/** What went wrong and how to fix it (DESIGN.md §11), from the step that
 * failed and Espressif's error text. */
export function explainFailure(step: Step, error: unknown): { title: string; detail: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (step === "permission" || /permission/i.test(message)) {
    return {
      title: "IO Driven needs Bluetooth access",
      detail: "Allow Nearby devices (or Location on older Android) for IO Driven in the phone's Settings, then try again.",
    };
  }
  if (/AUTH_FAILED|auth/i.test(message)) {
    return { title: "The Wi-Fi password is wrong", detail: "Check it, including capitals, and send it again." };
  }
  if (/NETWORK_NOT_FOUND/i.test(message)) {
    return {
      title: "The board couldn't find that network",
      detail: "The board only joins 2.4 GHz Wi-Fi. Check the network's name, move the board closer to the router, or pick another network.",
    };
  }
  if (step === "connect" && /not found|scan/i.test(message)) {
    return {
      title: "The board isn't nearby or isn't waiting for Wi-Fi",
      detail:
        "Keep the phone within a few metres and turn Bluetooth on. If the board already has Wi-Fi, hold its BOOT button (or, with a generated sketch on an ESP32, the button on GPIO 19) for 5 seconds while it runs, then try again.",
    };
  }
  if (step === "connect") {
    return {
      title: "The board didn't accept this QR",
      detail: "The QR is probably from an older credential. Scan the QR printed with the board's current sketch or firmware.",
    };
  }
  if (step === "scan") {
    return { title: "Couldn't list Wi-Fi networks", detail: "Try again, or type the network's name under Other network." };
  }
  return { title: "The board lost the connection", detail: "Keep the phone close to the board and try again." };
}
