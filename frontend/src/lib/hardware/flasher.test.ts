import { describe, expect, it } from "vitest";
import { explainFlashError, FlashError } from "./flasher";

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
