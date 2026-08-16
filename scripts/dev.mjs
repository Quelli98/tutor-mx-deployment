import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [
  spawn(npmCommand, ["run", "dev:backend"], { stdio: "inherit" }),
  spawn(npmCommand, ["run", "dev:frontend"], { stdio: "inherit" }),
];

function stopChildren(signal) {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on("SIGINT", () => stopChildren("SIGINT"));
process.on("SIGTERM", () => stopChildren("SIGTERM"));

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      stopChildren("SIGTERM");
      process.exitCode = code;
    }
  });
}
