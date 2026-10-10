import http from "node:http";
import { VerifiedProvider } from "../src/verified-rpc.mjs";
export async function dualFixture(network, dir) {
  const servers = [];
  try {
    for (let i = 0; i < 2; i++) {
      const s = http.createServer(async (req, res) => {
        let body = "";
        for await (const b of req) body += b;
        const input = JSON.parse(body),
          call = async (r) => {
            try {
              return {
                jsonrpc: "2.0",
                id: r.id,
                result: await network.request({
                  method: r.method,
                  params: r.params,
                }),
              };
            } catch (e) {
              return {
                jsonrpc: "2.0",
                id: r.id,
                error: {
                  code: e.code ?? -32000,
                  message: e.message,
                  data: e.data,
                },
              };
            }
          };
        const out = Array.isArray(input)
          ? await Promise.all(input.map(call))
          : await call(input);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(out));
      });
      await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
      servers.push(s);
    }
    const p = new VerifiedProvider(
      `http://127.0.0.1:${servers[0].address().port}`,
      `http://127.0.0.1:${servers[1].address().port}`,
      dir,
    );
    return {
      provider: p,
      close: async () => {
        p.destroy();
        await Promise.all(
          servers.map((s) => new Promise((resolve) => s.close(resolve))),
        );
      },
    };
  } catch (e) {
    for (const s of servers) s.close();
    throw e;
  }
}
