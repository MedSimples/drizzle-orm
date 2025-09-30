import { Log, LogLevel, Miniflare } from "miniflare";
import { newHttpBatchRpcSession, newWebSocketRpcSession, RpcSession, RpcSessionOptions, RpcStub, RpcTarget } from "capnweb";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = globalThis.__dirname ?? path.dirname(fileURLToPath(import.meta.url));

export const MF = () => new Miniflare({
  log: new Log(LogLevel.INFO),
  modules: [
    { type: "ESModule", path: path.join(__dirname, "worker.js") },
  ],
  compatibilityDate: "2025-09-23",
  compatibilityFlags: [
    "nodejs_compat",
    "enable_ctx_exports"
  ],
  name: "do-storage",
  host: "127.0.0.1",
  https: true,
  durableObjects: {
    DurableServer: {
      className: "DurableServer",
      useSQLite: true,
    },
  },
  durableObjectsPersist: path.join(__dirname, "db"),
});

const mf = MF();

class BatchClientTransport implements RpcTransport {
  constructor(sendBatch) {
    this.#promise = this.#scheduleBatch(sendBatch);
  }

  #promise: Promise<void>;
  #aborted: any;

  #batchToSend: string[] | null = [];
  #batchToReceive: string[] | null = null;

  async send(message: string): Promise<void> {
    // If the batch was already sent, we just ignore the message, because throwing may cause the
    // RPC system to abort prematurely. Once the last receive() is done then we'll throw an error
    // that aborts the RPC system at the right time and will propagate to all other requests.
    if (this.#batchToSend !== null) {
      this.#batchToSend.push(message);
    }
  }

  async receive(): Promise<string> {
    if (!this.#batchToReceive) {
      await this.#promise;
    }

    let msg = this.#batchToReceive!.shift();
    if (msg !== undefined) {
      return msg;
    } else {
      // No more messages. An error thrown here will propagate out of any calls that are still
      // open.
      throw new Error("Batch RPC request ended.");
    }
  }

  abort?(reason: any): void {
    this.#aborted = reason;
  }

  async #scheduleBatch(sendBatch) {
    // Wait for microtask queue to clear before sending a batch.
    //
    // Note that simply waiting for one turn of the microtask queue (await Promise.resolve()) is
    // not good enough here as the application needs a chance to call `.then()` on every RPC
    // promise in order to explicitly indicate they want the results. Unfortunately, `await`ing
    // a thenable does not call `.then()` immediately -- for some reason it waits for a turn of
    // the microtask queue first, *then* calls `.then()`.
    await new Promise(resolve => setTimeout(resolve, 0));

    if (this.#aborted !== undefined) {
      throw this.#aborted;
    }

    let batch = this.#batchToSend!;
    this.#batchToSend = null;
    this.#batchToReceive = await sendBatch(batch);
  }
}

export function newHttpBatchRpcSessionCustomFetch<T extends RpcTarget>(
  url: string,
  options?: RpcSessionOptions & { fetch: (url: string, options: RequestInit) => Promise<Response> }
): RpcStub<T> {

  const sendBatch = async (batch: string[]) => {
    const fetchFunc = options?.fetch ?? fetch;
    const response = await fetchFunc(url, {
      method: "POST",
      body: batch.join("\n"),
    });

    if (!response.ok) {
      response.body?.cancel();
      throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
    }

    let body = await response.text();
    return body == "" ? [] : body.split("\n");
  };

  let transport = new BatchClientTransport(sendBatch);
  let rpc = new RpcSession(transport, undefined, options);
  return rpc.getRemoteMain();

}

export const Storage = (id = 'default') => {
  const client = newHttpBatchRpcSessionCustomFetch('http://localhost:8787/rpc?id='+id, {
    fetch: (url, options) => {
      return mf.dispatchFetch(url, options)
    }
  });
  return {
    sql: {
      exec: (query: string, ...args: any[]) => {
        return client.sqlExec(query, args);
      },
    },
    [Symbol.dispose]() {
      mf.dispose();
    }
  }
}


export const StorageWS = async (id: string) => {
  const res: any = await mf.dispatchFetch("https://localhost:8787/rpc?id="+id, {
    headers: {
      Upgrade: "websocket",
    },
  });
  if (!res.ok) {
    console.error({
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body: await res.text(),
      webSocket: res.webSocket,
    });
    throw new Error("Failed to connect to DurableObject");
  }
  res.webSocket.accept();
  const clientWs = newWebSocketRpcSession<Record<string, any>>(res.webSocket);
  return {
    sql: {
      exec: (query: string, ...args: any[]) => {
        return clientWs.sqlExec(query, args);
      },
    },
    [Symbol.dispose]() {
      mf.dispose();
      clientWs[Symbol.dispose]?.()
    }
  }
}
