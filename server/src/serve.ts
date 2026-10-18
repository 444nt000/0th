// The HTTP shell the endpoints share, one JSON POST route each

import http from "node:http";

export function need(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

type Body = Record<string, unknown>;
type Route = (body: Body) => Promise<unknown>;

async function readBody(req: http.IncomingMessage) {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text ? (JSON.parse(text) as Body) : {};
}

export function serve(routes: Record<string, Route>, port: number) {
  http
    .createServer(async (req, res) => {
      // The page is cross-origin isolated and served from another port
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      if (req.method === "OPTIONS") return res.writeHead(204).end();

      const route = req.url && routes[req.url];
      if (!route) return res.writeHead(404).end();

      const json = (status: number, value: unknown) =>
        res
          .writeHead(status, { "content-type": "application/json" })
          .end(JSON.stringify(value));
      try {
        json(200, await route(await readBody(req)));
        console.log(`ok   ${req.url}`);
      } catch (e) {
        console.log(`fail ${req.url}: ${e}`);
        json(400, { error: String(e) });
      }
    })
    .listen(port, () => console.log(`server on http://127.0.0.1:${port}`));
}
