// Serves the demo console on http://localhost:4321 (reads data/demo-run.json from npm run demo).
// Run: npm run console
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4321);
const routes: Record<string, [string, string]> = {
  "/": ["console/index.html", "text/html; charset=utf-8"],
  "/demo-run.json": ["data/demo-run.json", "application/json"],
  "/demo-run-live.json": ["data/demo-run-live.json", "application/json"],
};

createServer(async (req, res) => {
  const route = routes[(req.url ?? "/").split("?")[0]];
  if (!route) {
    res.writeHead(404).end("Not found");
    return;
  }
  try {
    const body = await readFile(route[0]);
    res.writeHead(200, { "Content-Type": route[1], "Cache-Control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end(route[0].startsWith("data/") ? "Run npm run demo (or demo:live) first" : "Not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Payday Guardian console on http://localhost:${PORT}`));
