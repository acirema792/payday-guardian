// Copies the console and both runs into docs/console, so GitHub Pages (main, /docs) can host the
// demo for judges without cloning. Run after npm run demo and npm run evidence: npm run site
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";

mkdirSync("docs/console", { recursive: true });
copyFileSync("console/index.html", "docs/console/index.html");
copyFileSync("data/demo-run.json", "docs/console/demo-run.json");
copyFileSync("docs/evidence/live-run.json", "docs/console/demo-run-live.json");
writeFileSync("docs/.nojekyll", "");
writeFileSync(
  "docs/index.html",
  `<!doctype html><meta charset="utf-8"><title>Payday Guardian</title><meta http-equiv="refresh" content="0; url=console/?run=live"><a href="console/?run=live">Payday Guardian console</a>\n`,
);
console.log("Wrote docs/console (offline and live runs) and docs/index.html");
