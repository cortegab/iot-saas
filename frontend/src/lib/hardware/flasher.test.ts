import { describe, expect, it } from "vitest";
import { chipForName, explainFlashError, FlashError, nextAttempt, nextSlower, overallFraction } from "./flasher";

describe("explainFlashError", () => {
  it("names a busy COM port, the bench's most common failure", () => {
    // The exact text Chrome gave with a serial monitor still open on COM3.
    const e = explainFlashError(new Error("Failed to execute 'open' on 'SerialPort': Failed to open serial port."), "connecting");
    expect(e.message).toMatch(/COM port is busy\. Close any serial monitor/);
    expect(e.retryable).toBe(false);
  });

  it("treats a port that's already open the same way", () => {
    const err = Object.assign(new Error("The port is already open."), { name: "InvalidStateError" });
    expect(explainFlashError(err, "connecting").message).toMatch(/COM port is busy/);
  });

  it("tells a board that didn't answer to hold BOOT", () => {
    const e = explainFlashError(new Error("Failed to connect with the device"), "connecting");
    expect(e.message).toMatch(/Hold its BOOT button/);
    expect(e.retryable).toBe(false);
  });

  it("tells a board that answered, then stopped, something other than BOOT", () => {
    const e = explainFlashError(new Error("Unable to verify flash chip connection Error: Timeout"), "connecting", true);
    expect(e.message).toMatch(/answered, then stopped responding/);
    expect(e.message).not.toMatch(/BOOT/);
    expect(e.retryable).toBe(false);
  });

  it("says when the board was unplugged", () => {
    const err = Object.assign(new Error("The device has been lost."), { name: "NetworkError" });
    expect(explainFlashError(err, "writing")).toMatchObject({ retryable: false, message: expect.stringMatching(/disconnected/) });
  });

  it("lets only a transfer that failed mid-write be retried", () => {
    expect(explainFlashError(new Error("Timeout"), "writing").retryable).toBe(true);
    expect(explainFlashError(new Error("Couldn't download esp32/firmware.bin (404)."), "downloading").retryable).toBe(false);
  });

  it("keeps an error that's already explained", () => {
    const wrongBoard = new FlashError("This board is an ESP32-C3, but you picked ESP32.", "connecting", false);
    expect(explainFlashError(wrongBoard, "connecting")).toBe(wrongBoard);
  });
});

describe("speed ladder", () => {
  it("steps 921600 → 460800 → 115200, then stops", () => {
    expect(nextSlower(921600)).toBe(460800);
    expect(nextSlower(460800)).toBe(115200);
    expect(nextSlower(115200)).toBeNull();
  });

  it("retries slower only when the link dropped", () => {
    // Answered, then lost at the speed switch (the CP2102 on the bench).
    expect(nextAttempt({ stage: "connecting", synced: true, retryable: false, baud: 921600 })).toBe(460800);
    // Never answered: slower won't help, BOOT might.
    expect(nextAttempt({ stage: "connecting", synced: false, retryable: false, baud: 921600 })).toBeNull();
    // A transfer that dropped mid-write.
    expect(nextAttempt({ stage: "writing", synced: true, retryable: true, baud: 460800 })).toBe(115200);
    // Unplugged mid-write.
    expect(nextAttempt({ stage: "writing", synced: true, retryable: false, baud: 921600 })).toBeNull();
    // Already at the bottom.
    expect(nextAttempt({ stage: "connecting", synced: true, retryable: false, baud: 115200 })).toBeNull();
  });
});

describe("overallFraction", () => {
  const sizes = [100, 300, 100];

  it("weights each file by its size", () => {
    expect(overallFraction(sizes, 0, 50, 100)).toBeCloseTo(0.1);
    expect(overallFraction(sizes, 1, 150, 300)).toBeCloseTo(0.5);
    expect(overallFraction(sizes, 2, 100, 100)).toBe(1);
  });

  it("copes with esptool's compressed totals and empty files", () => {
    // `total` is the compressed size, not the file's: only the ratio counts.
    expect(overallFraction(sizes, 1, 30, 60)).toBeCloseTo(0.5);
    expect(overallFraction([0, 0], 0, 0, 0)).toBe(1);
    expect(overallFraction(sizes, 0, 0, 0)).toBeCloseTo(0.2);
  });
});

describe("chipForName", () => {
  it("finds the release build for the chip esptool reports", () => {
    const manifest = { boards: { esp32: { chip: "ESP32" }, esp32c3: { chip: "ESP32-C3" } } } as never;
    expect(chipForName(manifest, "ESP32-C3")).toBe("esp32c3");
    expect(chipForName(manifest, "ESP32-S3")).toBeNull();
  });
});
