import { execFileSync } from "node:child_process";
import { readFileSync, statSync, readdirSync } from "node:fs";

// A source ZIP has no Git index; scan its source tree instead of failing or
// accidentally checking an unrelated parent repository.
function sourceFiles(directory = '.') {
  const excluded = new Set(['.git', 'node_modules', 'dist', 'coverage', '.vscode']);
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (excluded.has(entry.name)) return [];
    const path = directory === '.' ? entry.name : `${directory}/${entry.name}`;
    if (path === 'src/generated' || entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}
let trackedFiles;
try {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (root !== process.cwd()) throw new Error('No repository index for this source root');
  trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
} catch {
  trackedFiles = sourceFiles();
}

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
  /\b(?:AUTH0_MANAGEMENT_TOKEN|CODECOV_TOKEN)\s*=(?!=)\s*(?!["']?\$)[^\s${][^\s]*/,
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
  "ChatGPT[",
  "Qoder[",
  "Assisted-by:",
];
for (const declaration of requiredAiDeclarations) {
  if (!readme.includes(declaration)) {
    throw new Error(`README.md is missing AI declaration: ${declaration}`);
  }
}

console.log("Source secret and AI declaration structure checks passed. Model provenance and historical commit trailers require human verification.");
