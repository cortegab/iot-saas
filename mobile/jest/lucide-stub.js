// lucide-react-native ships ESM-only (.mjs), which jest-expo doesn't transform.
// Icons don't matter to these tests: every icon renders nothing.
module.exports = new Proxy(
  {},
  { get: (_target, name) => (name === "__esModule" ? false : () => null) },
);
