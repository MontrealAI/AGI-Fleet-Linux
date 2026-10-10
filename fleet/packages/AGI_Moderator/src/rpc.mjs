import { FetchRequest, JsonRpcProvider } from "ethers";
import { VerifiedProvider } from "./verified-rpc.mjs";
import { Chain } from "./chain.mjs";
import { ensure } from "./util.mjs";
export function validRPC(value) {
  ensure(
    typeof value === "string" && value.length > 0 && value.length <= 4096,
    "RPC_NOT_CONFIGURED",
  );
  const u = new URL(value);
  ensure(
    !u.username &&
      !u.password &&
      !u.hash &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))),
    "RPC_REQUIRES_HTTPS_OR_LOOPBACK",
  );
  return value;
}
export function connectChain(c, url, verificationURL = null) {
  validRPC(url);
  if (verificationURL) {
    validRPC(verificationURL);
    const a = new URL(url),
      b = new URL(verificationURL);
    ensure(
      c.chainId === 31337 ? a.href !== b.href : a.hostname !== b.hostname,
      "RPC_PROVIDERS_MUST_DIFFER",
    );
    return new Chain(c, new VerifiedProvider(url, verificationURL, c.dataDir));
  }
  const request = new FetchRequest(url);
  request.timeout = 30000;
  request.setThrottleParams({ maxAttempts: 2, slotInterval: 1000 });
  return new Chain(
    c,
    new JsonRpcProvider(request, undefined, { cacheTimeout: -1 }),
  );
}
