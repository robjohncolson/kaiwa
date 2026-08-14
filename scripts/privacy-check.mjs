import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const PUBLIC_FILES = [
  "data/scenarios.json",
  "data/readings.json",
  "data/tree.json",
  "data/missions.json",
  "data/private-overlay.example.json"
];
const FORBIDDEN_HASHES = [
  { length: 4, hash: "cbe42b7ff5c483223472a6ed7d37f49ef805c97e1f462d7a9f967f4b082d17a2" },
  { length: 6, hash: "83fe1a32778d2130b54d5b884ab15509d64f0820d8ae3377d7bf3b71c827e73b" },
  { length: 6, hash: "8d99660c5b2ac9ef0d41c8dcfcc3b44db1c0f748baaf90d3512f14238af6e839" }
];

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function localDenylist() {
  try {
    return (await readFile(".kaiwa-private-denylist", "utf8"))
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) => value && !value.startsWith("#"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

const privateValues = await localDenylist();
const failures = [];
for (const path of PUBLIC_FILES) {
  const text = await readFile(path, "utf8");
  for (const value of privateValues) {
    if (text.includes(value)) failures.push(`${path} contains a local deny-list value.`);
  }
  const characters = [...text];
  for (const rule of FORBIDDEN_HASHES) {
    let found = false;
    for (let index = 0; index <= characters.length - rule.length; index += 1) {
      if (digest(characters.slice(index, index + rule.length).join("")) === rule.hash) {
        found = true;
        break;
      }
    }
    if (found) failures.push(`${path} contains a built-in private identifier.`);
  }
  if (/google\.com\/maps|〒|\b\d{2,3}\.\d{4,},\s*\d{3}\.\d{4,}\b/.test(text)) {
    failures.push(`${path} contains a prohibited live-location pattern.`);
  }
}

if (failures.length > 0) {
  throw new Error(`Kaiwa privacy check failed:\n- ${failures.join("\n- ")}`);
}
process.stdout.write(`Privacy check passed for ${PUBLIC_FILES.length} public content files.\n`);
