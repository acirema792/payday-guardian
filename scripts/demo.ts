// Runs the 5-minute demo end to end and writes the timeline for the console.
// Run: npm run demo   (offline bank; deterministic, no credentials needed)
import { mkdirSync, writeFileSync } from "node:fs";
import { offlineEnvironment } from "../src/demo/environment.ts";
import { type DemoEvent, runDemo } from "../src/demo/runner.ts";

const env = await offlineEnvironment();
const events: DemoEvent[] = [];
const label: Record<DemoEvent["phase"], string> = {
  goal: "GOAL",
  plan: "PLAN",
  new_info: "NEW INFORMATION",
  decision: "REVISED DECISION",
  action: "ACTION",
  result: "RESULT",
};

console.log(`Payday Guardian demo on ${env.label}\n`);
const summary = await runDemo(env, (e) => {
  events.push(e);
  console.log(`${e.at.slice(11, 16)} UTC  ${label[e.phase]}  ${e.title}`);
  for (const line of e.lines) console.log(`           ${line}`);
  console.log();
});

mkdirSync("data", { recursive: true });
writeFileSync("data/demo-run.json", JSON.stringify({ environment: env.label, events, summary }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log("Timeline written to data/demo-run.json");
env.store.close();
