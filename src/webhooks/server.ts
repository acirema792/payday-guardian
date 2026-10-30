import { createServer, type Server } from "node:http";
import type { WebhookReceiver, WebhookResult } from "./airwallex.ts";

// POST /webhooks/airwallex: hands the raw body to the receiver before any parsing, answers at once.
export const WEBHOOK_PATH = "/webhooks/airwallex";

export function startWebhookServer(receiver: WebhookReceiver, port: number, onResult?: (r: WebhookResult) => void): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== WEBHOOK_PATH) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const header = (name: string) => (Array.isArray(req.headers[name]) ? req.headers[name][0] : req.headers[name]);
      const result = receiver.receive({ timestamp: header("x-timestamp"), signature: header("x-signature") }, Buffer.concat(chunks).toString("utf8"));
      res.writeHead(result.http).end();
      onResult?.(result);
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
