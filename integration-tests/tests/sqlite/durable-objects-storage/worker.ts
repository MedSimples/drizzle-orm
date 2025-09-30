import { WorkerEntrypoint } from 'cloudflare:workers';
import type { DurableServer } from './durable-server';

export { DurableServer } from './durable-server';

class Entrypoint extends WorkerEntrypoint {
	override async fetch(req: Request) {
		const { pathname } = new URL(req.url);
		if (pathname === '/ws') {
			const upgradeHeader = req.headers.get('Upgrade');
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				return new Response('Worker expected Upgrade: websocket', {
					status: 426,
				});
			}
			if (req.method !== 'GET') {
				return new Response('Worker expected GET method', {
					status: 400,
				});
			}
			return this.getActor('ws').fetch(req);
		}

		return this.getActor('rpc').fetch(req);
	}

	getActor(name = 'default') {
		// @ts-ignore
		const ns = this.ctx?.props?.DurableServer ?? this.env?.DurableServer;
		if (!name) {
			throw new Error('Durable object name is not set');
		}
		return ns.getByName(name);
	}
}

export default Entrypoint;
