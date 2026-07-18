/* global process */

import readline from "node:readline";

const lines = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

lines.on("line", (line) => {
  const value = JSON.parse(line);
  process.stdout.write(`${JSON.stringify(value)}\n`);
});

process.once("SIGTERM", () => {
  lines.close();
  process.exit(0);
});
