// In-process Postgres (PGlite) exposed over the real Postgres wire protocol, so the
// production server (server/app.mjs + node-postgres) can be exercised without Docker.
// Usage: node tools/pg-dev.mjs [--port 55432]   then DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const i = process.argv.indexOf('--port');
const port = Number(i > -1 ? process.argv[i + 1] : 55432);
const db = await PGlite.create();
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
await server.start();
console.log(`PGlite listening on postgres://postgres@127.0.0.1:${port}/postgres`);
const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
