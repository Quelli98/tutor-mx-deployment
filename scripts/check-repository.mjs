import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const forbiddenEnvironmentFiles = trackedFiles.filter(
  (file) => {
    const name = file.split("/").at(-1);
    return (name === ".env" || name?.startsWith(".env.")) && name !== ".env.example";
  },
);

if (forbiddenEnvironmentFiles.length > 0) {
  throw new Error(
    `Tracked environment files are forbidden: ${forbiddenEnvironmentFiles.join(", ")}`,
  );
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:AUTH0_MANAGEMENT_TOKEN|CODECOV_TOKEN)\s*=\s*[^\s${][^\s]*/,
  /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/,
];

for (const file of trackedFiles) {
  if (file.endsWith(".env.example") || statSync(file).size > 1_000_000) {
    continue;
  }
  let content = readFileSync(file, "utf8");
  if (file === ".gitea/workflows/ci.yml") {
    // Allow only the exact ephemeral service URL on its own DATABASE_URL line.
    content = content.replace(
      /^([ \t]*DATABASE_URL:[ \t]*)postgresql:\/\/tutor_mx:tutor_mx@postgres:5432\/tutor_mx(?=[ \t]*\r?$)/gm,
      "$1[ephemeral CI database]",
    );
  }
  if (secretPatterns.some((pattern) => pattern.test(content))) {
    throw new Error(`Possible committed secret found in ${file}`);
  }
}

const readme = readFileSync("README.md", "utf8");
const requiredAiDeclarations = [
  "AI code generation",
  "AI in-line editing",
  "AI code review",
  "Codex[GPT-5]",
];
for (const declaration of requiredAiDeclarations) {
  if (!readme.includes(declaration)) {
    throw new Error(`README.md is missing AI declaration: ${declaration}`);
  }
}

console.log("Tracked-file secret and AI-attribution checks passed.");
