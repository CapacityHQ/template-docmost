#!/usr/bin/env node
// Capacity setup step "secrets" (.capacity/runtime.json), run once per project
// before the first start.
//
// Docmost refuses to start without APP_SECRET (it signs the session tokens;
// at least 32 characters, and its own placeholder REPLACE_WITH_LONG_SECRET is
// rejected). .env.example ships it empty, so this fills it in the project's
// root .env with a random value: no project ever runs on a secret published
// in the template.
//
// A value that is already set is never touched, and the value is never
// printed. Running it again changes nothing.
import { randomBytes } from "node:crypto";
import { constants, copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const examplePath = join(root, ".env.example");

const SECRETS = [
  // `openssl rand -hex 32`, the recipe .env.example gives: 64 hex characters
  { name: "APP_SECRET", generate: () => randomBytes(32).toString("hex"), minLength: 32 },
];

/** The value dotenv reads from the text after `NAME=`: quotes dropped, an
 *  unquoted value cut at its inline comment. */
function valueOf(raw) {
  const token = raw.trim();
  const quote = token[0];
  if (quote === '"' || quote === "'" || quote === "`") {
    const close = token.indexOf(quote, 1);
    if (close !== -1) return token.slice(1, close);
  }
  const hash = token.indexOf("#");
  return (hash === -1 ? token : token.slice(0, hash)).trim();
}

if (!existsSync(envPath)) {
  if (!existsSync(examplePath)) {
    console.error(`ensure-secrets: neither ${envPath} nor ${examplePath} exists`);
    process.exit(1);
  }
  // Capacity Desktop creates .env from the example when the project is
  // created; this covers a checkout that lost it.
  copyFileSync(examplePath, envPath, constants.COPYFILE_EXCL);
  console.log("ensure-secrets: created .env from .env.example");
}

const original = readFileSync(envPath, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
const lines = original.split(/\r?\n/);
let changed = false;

for (const secret of SECRETS) {
  const pattern = new RegExp(`^${secret.name}=(.*)$`);
  // dotenv keeps the last occurrence of a name, so that is the one to read.
  let index = -1;
  for (let i = 0; i < lines.length; i++) if (pattern.test(lines[i])) index = i;
  const current = index === -1 ? "" : valueOf(lines[index].match(pattern)[1]);
  if (current !== "") {
    if (secret.minLength && current.length < secret.minLength) {
      console.warn(
        `ensure-secrets: ${secret.name} is set but is ${current.length} characters long; Docmost needs at least ${secret.minLength}`,
      );
    } else {
      console.log(`ensure-secrets: ${secret.name} is already set`);
    }
    continue;
  }
  const line = `${secret.name}=${secret.generate()}`;
  if (index === -1) {
    // Keep the file's last line (usually empty, from the final newline) last.
    const at = lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
    lines.splice(at, 0, line);
  } else {
    lines[index] = line;
  }
  changed = true;
  console.log(`ensure-secrets: ${secret.name} generated`);
}

if (changed) {
  // Written next to the file and renamed over it, so a crash midway never
  // leaves a half-written .env behind.
  const tmpPath = `${envPath}.capacity-tmp`;
  writeFileSync(tmpPath, lines.join(eol), { mode: statSync(envPath).mode & 0o777 });
  renameSync(tmpPath, envPath);
}
