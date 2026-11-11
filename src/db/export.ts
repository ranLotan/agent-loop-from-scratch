// Writes data/rules.json from the database: a readable backup of your categories and rules.
// The file is gitignored (it holds real merchant names). Run with: npm run export

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, loadRules } from "../store";
import { formatRulesFile } from "./rules";

const rules = loadRules();
const path = join(DATA_DIR, "rules.json");
writeFileSync(path, formatRulesFile(rules), "utf8");
console.log(`Exported ${rules.categories.length} categories and ${rules.rules.length} rules → ${path}`);
