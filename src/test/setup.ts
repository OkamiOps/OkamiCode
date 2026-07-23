import "@testing-library/jest-dom/vitest";

// Node 26 exposes an incomplete experimental Web Storage global when no
// --localstorage-file is configured. Install a deterministic in-memory Storage
// for jsdom so renderer tests keep the browser contract without writing to the
// developer machine.
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(String(key)),
    setItem: (key, value) => values.set(String(key), String(value)),
  };
}

const local = memoryStorage();
const session = memoryStorage();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: local,
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: session,
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: local,
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: session,
  });
}
