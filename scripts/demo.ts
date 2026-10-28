// Runs the 5-minute demo end to end and writes the timeline for the console.
// Run: npm run demo                    (offline bank, rule-based reader; deterministic, no credentials)
//      npm run demo -- --reader claude (offline bank, Claude reads the messages; needs ANTHROPIC_API_KEY)
//      npm run demo:live -- --reader claude (Airwallex sandbox, Kit 6 connected accounts from npm run provision)
import { mkdirSync, writeFileSync } from "node:fs";
import { claudeInterpreter, type Reading } from "../src/agent/claude-interpreter.ts";
import { type DemoEnvironment, offlineEnvironment } from "../src/demo/environment.ts";
import { liveEnvironment } from "../src/demo/live-environment.ts";
import { type DemoEvent, runDemo } from "../src/demo/runner.ts";

const useClaude = process.argv.includes("--reader") && process.argv[process.argv.indexOf("--reader") + 1] === "claude";
const readings = new Map<string, { reading?: Reading; note: string }>();
const live = process.argv.includes("--live");
const readerOptions = (
  useClaude
    ? {
        interpreter: claudeInterpreter({ onReading: (m, reading, note) => readings.set(m.id, { reading, note }) }),
        readingNotes: (id) => {
          const r = readings.get(id);
          if (!r) return [];
          if (!r.reading) return [`Reader note: ${r.note}`];
          return [`Claude's summary: ${r.reading.summary}`, ...(r.reading.red_flags.length ? [`Red flags: ${r.reading.red_flags.join("; ")}`] : [])];
        },
      }
    : {}
) as Parameters<typeof offlineEnvironment>[0];
const env: DemoEnvironment = live
  ? await liveEnvironment({ ...readerOptions, log: (line) => console.log(`[setup] ${line}`) })
  : await offlineEnvironment(readerOptions);

const events: DemoEvent[] = [];
const label: Record<DemoEvent["phase"], string> = {
  goal: "GOAL",
  plan: "PLAN",
  new_info: "NEW INFORMATION",
  decision: "REVISED DECISION",
  action: "ACTION",
  result: "RESULT",
};

console.log(`Payday Guardian demo on ${env.label}, reader: ${env.interpreter.name}\n`);
const summary = await runDemo(env, (e) => {
  events.push(e);
  console.log(`${e.at.slice(11, 16)} UTC  ${label[e.phase]}  ${e.title}`);
  for (const line of e.lines) console.log(`           ${line}`);
  console.log();
});

mkdirSync("data", { recursive: true });
const out = live ? "data/demo-run-live.json" : "data/demo-run.json";
writeFileSync(
  out,
  JSON.stringify({ environment: env.label, reader: env.interpreter.name, events, summary }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2),
);
console.log(`Timeline written to ${out}`);
env.store.close();
