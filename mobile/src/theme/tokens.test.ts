import { readFileSync } from "node:fs";
import path from "node:path";
import { dark, light, type ColorToken } from "./tokens";

// The web's tokens are the source (DESIGN.md); this keeps the app's copy honest.
const css = readFileSync(path.join(__dirname, "../../../frontend/src/app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const kebab = (token: ColorToken) => token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe("tokens match frontend/src/app/globals.css", () => {
  it.each([
    ["light", ":root", light],
    ["dark", ":root.dark", dark],
  ] as const)("%s", (_name, selector, palette) => {
    const web = block(selector);
    for (const [token, value] of Object.entries(palette)) {
      expect([token, web[kebab(token as ColorToken)]]).toEqual([token, value]);
    }
  });
});
