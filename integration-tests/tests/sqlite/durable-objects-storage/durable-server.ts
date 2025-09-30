import { newWorkersRpcResponse, RpcTarget } from "capnweb";
import { DurableObject } from 'cloudflare:workers';

export interface IDurableObjectServer extends DurableObjectStorage {
	fetch(request: Request): Response | Promise<Response>;
	alarm(scheduledTime: number | Date, options?: DurableObjectSetAlarmOptions): void | Promise<void>;
	query(query: string, ...args: any[]): Record<string, SqlStorageValue>[];
}

export class DurableObjectServer extends RpcTarget implements Omit<IDurableObjectServer, 'get' | 'put' | 'delete' | 'fetch' | 'sql' | 'kv' | 'ensureReplicas' | 'disableReplicas' > {
	env: Cloudflare.Env;
	ctx: DurableObjectState<{}>;
	storage: DurableObjectStorage;
	constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
		super();
		this.ctx = ctx;
		this.env = env;
		this.storage = ctx.storage;
	}
	waitUntil(promise: Promise<any>): void {
		this.ctx.waitUntil(promise);
	}
	props() {
		return this.ctx.props;
	}
	id() {
		return this.ctx.id;
	}
	blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
		return this.ctx.blockConcurrencyWhile(callback);
	}
	abort(reason?: string): void {
		this.ctx.abort(reason);
	}
	getValue(keys: string[], options?: unknown) {
		return this.storage.get(keys, options);
	}
	list(options?: unknown) {
		return this.storage.list(options);
	}
	putValue(key: string, value?: unknown, options?: unknown) {
		return this.storage.put(key, value, options);
	}
	deleteValue(keys: string[], options?: unknown) {
		return this.storage.delete(keys, options);
	}
	deleteAll(options?: unknown) {
		return this.storage.deleteAll(options);
	}
	transaction(closure: (txn: DurableObjectTransaction) => Promise<unknown>) {
		return this.storage.transaction(closure);
	}
	getAlarm(options?: unknown) {
		return this.storage.getAlarm(options);
	}
	setAlarm(scheduledTime: number | Date, options?: unknown) {
		return this.storage.setAlarm(scheduledTime, options);
	}
	deleteAlarm(options?: unknown) {
		return this.storage.deleteAlarm(options);
	}
	sync() {
		return this.storage.sync();
	}
	transactionSync(closure: () => unknown) {
		return this.storage.transactionSync(closure);
	}
	getCurrentBookmark(): Promise<string> {
		return this.storage.getCurrentBookmark();
	}
	getBookmarkForTime(timestamp: number | Date) {
		return this.storage.getBookmarkForTime(timestamp);
	}
	onNextSessionRestoreBookmark(bookmark: string) {
		return this.storage.onNextSessionRestoreBookmark(bookmark);
	}
	waitForBookmark(bookmark: string): Promise<void> {
		return this.storage.waitForBookmark(bookmark);
	}
	alarm(scheduledTime: number | Date, options?: DurableObjectSetAlarmOptions) {
		return this.storage.setAlarm(scheduledTime, options);
	}
	query(query: string, args?: any[]) {
		return [...this.storage.sql.exec(query, ...args ?? [])];
	}
	first(query: string, args?: any[]) {
		const result = this.storage.sql.exec(query, ...args ?? []).one();
		if (Object.keys(result).length === 1) {
			return Object.values(result)[0];
		}
		return result;
	}
	databaseSize() {
		return this.storage.sql.databaseSize;
	}
}

export class DurableServer extends DurableObject {
	sessions: Map<WebSocket, any>;
	rpcHandler: DurableObjectWebSocketRpcHandler;
	storageProxy: any;

	constructor(ctx, env) {
		super(ctx, env);
		this.sessions = new Map();
		this.rpcHandler = newDurableObjectWebSocketRpcResponse(new DurableObjectServer(this.ctx, this.env));
		for (const ws of this.ctx.getWebSockets()) {
			let attachment = ws.deserializeAttachment();
			if (attachment) {
				this.sessions.set(ws, { ...attachment });
				this.rpcHandler.initSession(ws);
			}
		}
		this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
	}

	fetch(request) {
		const { pathname } = new URL(request.url);
		if (pathname === '/') {
			return new Response('ok');
		}

		if (pathname === '/rpc') {
			return newWorkersRpcResponse(request, new DurableObjectServer(this.ctx, this.env));
		}

		if (pathname === '/ws') {
			const webSocketPair = new WebSocketPair();
			const [client, server] = Object.values(webSocketPair);
			this.ctx.acceptWebSocket(server);
			const id = crypto.randomUUID();
			server.serializeAttachment({ id });
			this.sessions.set(server, { id });
			this.rpcHandler.initSession(server);
			return new Response(null, {
				status: 101,
				webSocket: client,
			});
		}

		return new Response('Not Found', { status: 404 });
	}

	async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
		await this.rpcHandler.handleMessage(ws, message);
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
		await this.rpcHandler.handleClose(ws, code, reason, wasClean);
		this.sessions.delete(ws);
	}

	async webSocketError(ws: WebSocket, error: unknown) {
		await this.rpcHandler.handleError(ws, error);
	}

	sql(query, bindings = []) {
		return Array.from(this.ctx.storage.sql.exec(query, ...bindings));
	}
}
