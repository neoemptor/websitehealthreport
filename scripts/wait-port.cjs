// Waits until something accepts TCP connections on the given port, then
// exits 0 — so `electron:dev` starts Electron only once Vite is up, instead
// of racing it and falling back to the static build. Exits 1 after 30s.
const net = require('net');

const port = Number(process.argv[2]);
if (!port) {
	console.error('usage: node scripts/wait-port.cjs <port>');
	process.exit(2);
}

const deadline = Date.now() + 30_000;

function attempt() {
	const socket = net.connect({ port, host: '127.0.0.1' });
	socket.once('connect', () => {
		socket.end();
		process.exit(0);
	});
	socket.once('error', () => {
		socket.destroy();
		if (Date.now() > deadline) {
			console.error(`Nothing answered on port ${port} within 30s.`);
			process.exit(1);
		}
		setTimeout(attempt, 250);
	});
}

attempt();
