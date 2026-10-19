import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import Redis from 'ioredis';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

// Destinos fijos y locales: este laboratorio nunca acepta URLs de una BD real.
const users = Number(process.env.CAPACITY_USERS ?? 250);
const seconds = Number(process.env.CAPACITY_SECONDS ?? 60);
const dockerApi = process.env.CAPACITY_RUNTIME !== 'host';
assert(Number.isInteger(users) && users >= 2 && users <= 1000);
assert(Number.isInteger(seconds) && seconds >= 10 && seconds <= 3600);
const base = 'http://127.0.0.1:18080/api/v1';
const databaseUrl =
  'postgresql://capacity:capacity-local-only@127.0.0.1:15435/capacity';
const compose = ['compose', '-f', 'compose.capacity.yaml', '--profile', 'api'];
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: '18080',
  API_PREFIX: 'api',
  API_VERSION: 'v1',
  DATABASE_URL: databaseUrl,
  DATABASE_LOG_QUERIES: 'false',
  DATABASE_POOL_MAX: process.env.CAPACITY_POOL_MAX ?? '20',
  DATABASE_CONNECTION_TIMEOUT: '2000',
  DATABASE_STATEMENT_TIMEOUT: '5000',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '16380',
  REDIS_PASSWORD: '',
  REDIS_DB: '0',
  REDIS_KEY_PREFIX: 'capacity:',
  REDIS_DEFAULT_TTL: '300',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  S3_BUCKET: 'capacity',
  S3_ACCESS_KEY_ID: 'capacity',
  S3_SECRET_ACCESS_KEY: 'capacity',
  DWH_HOST: '',
  SYNC_PRODUCTS_ENABLED: 'false',
  PUSH_TARGET_DATABASE_URL: '',
  AUTH_JWKS_URL: 'http://127.0.0.1:18081/jwks',
  AUTH_JWT_ISSUER: 'capacity',
  AUTH_JWT_AUDIENCE: 'capacity',
  TRUST_PROXY: '',
  HTTP_MAX_INFLIGHT: '500',
  // Todos los VU salen por loopback. Conserva Lua/Redis pero eleva la cuota
  // únicamente en este laboratorio para medir capacidad sin el efecto NAT.
  RATE_LIMIT_MAX: '1000000',
  RATE_LIMIT_TTL: '60',
};

function run(command, args, stdio = 'inherit') {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio,
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command}: exit ${code}`)),
    );
  });
}

async function request(path, { token, method = 'GET', body } = {}) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  const text = await response.text();
  return {
    status: response.status,
    ms: performance.now() - started,
    cacheControl: response.headers.get('cache-control'),
    body: text ? JSON.parse(text) : null,
  };
}

async function waitReady() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await request('/health/ready')).status === 200) return;
    } catch {
      /* arranque */
    }
    await sleep(1000);
  }
  throw new Error('API no lista; revisar reports/capacity-api.log');
}

function summarize(samples) {
  const durations = samples.map((s) => s.ms).sort((a, b) => a - b);
  const percentile = (p) =>
    Math.round(durations[Math.ceil(durations.length * p) - 1] ?? 0);
  const errors = samples.filter(
    (s) => s.status < 200 || s.status >= 300,
  ).length;
  return {
    requests: samples.length,
    errors,
    errorRate: errors / samples.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    statuses: samples.reduce(
      (counts, s) => ({ ...counts, [s.status]: (counts[s.status] ?? 0) + 1 }),
      {},
    ),
  };
}

let api;
let log;
let pool;
let redis;
let jwksServer;
let startedCompose = false;
try {
  await mkdir('reports', { recursive: true });
  if (dockerApi) await run('docker', [...compose, 'build', 'api']);
  await run('docker', [...compose, 'up', '-d', '--wait', 'postgres', 'redis']);
  startedCompose = true;
  await run(process.execPath, [
    'node_modules/prisma/build/index.js',
    'migrate',
    'deploy',
  ]);
  pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  await pool.query(`
    INSERT INTO suppliers (code, name, updated_at)
    SELECT 'S' || n, 'Proveedor ' || n, now() FROM generate_series(1,20) n;
    INSERT INTO brands (name, slug) SELECT 'Marca ' || n, 'marca-' || n FROM generate_series(1,40) n;
    INSERT INTO products (producto_key, sku, name, supplier_id, brand_id, active, synced_at, source_hash, updated_at, long_description)
    SELECT 'K' || n, 'SKU-' || n, 'Producto ' || lpad(n::text, 5, '0'),
      1 + n % 20, 1 + n % 40, true, now(), 'fixture', now(), repeat('Descripción de prueba. ', 12)
    FROM generate_series(1,20000) n;
    INSERT INTO product_images (product_id, object_key, url, thumb_url, card_url, full_url, is_primary, updated_at, source_checksum)
    SELECT id, 'fixture/' || id, 'https://example.invalid/image.webp',
      'https://example.invalid/thumb.webp', 'https://example.invalid/card.webp',
      'https://example.invalid/full.webp', true, now(), 'fixture' FROM products WHERE id % 3 = 0;
    ANALYZE;
  `);
  redis = new Redis({ host: '127.0.0.1', port: 16380 });
  redis.on('error', () => {});
  const { publicKey, privateKey } = await generateKeyPair('EdDSA');
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: 'capacity',
    alg: 'EdDSA',
    use: 'sig',
  };
  jwksServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve, reject) => {
    jwksServer.once('error', reject);
    jwksServer.listen(18081, dockerApi ? '0.0.0.0' : '127.0.0.1', resolve);
  });
  const tokens = await Promise.all(
    Array.from({ length: users }, (_, i) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'EdDSA', kid: 'capacity' })
        .setSubject(`capacity-${i}`)
        .setIssuer('capacity')
        .setAudience('capacity')
        .setIssuedAt()
        .setExpirationTime('2h')
        .sign(privateKey),
    ),
  );
  log = await open('reports/capacity-api.log', 'w');
  if (dockerApi) {
    await run('docker', [...compose, 'up', '-d', 'api']);
  } else {
    api = spawn(process.execPath, ['dist/src/main.js'], {
      env,
      stdio: ['ignore', log.fd, log.fd],
      windowsHide: true,
    });
    api.on('error', (error) => console.error(error));
  }
  await waitReady();

  console.log(
    'Verificando concurrencia de escrituras y aislamiento de usuarios...',
  );
  const creations = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      request('/order-lists', {
        token: tokens[0],
        method: 'POST',
        body: { name: `Carrera ${i}` },
      }),
    ),
  );
  assert.equal(creations.filter((r) => r.status === 201).length, 10);
  assert.equal(creations.filter((r) => r.status === 409).length, 10);
  const listId = creations.find((r) => r.status === 201).body.id;
  assert.equal(
    (await request(`/order-lists/${listId}`, { token: tokens[1] })).status,
    404,
  );
  const writes = await Promise.all(
    Array.from({ length: 25 }, () =>
      request(`/order-lists/${listId}/items/1`, {
        token: tokens[0],
        method: 'PUT',
        body: { quantity: 2 },
      }),
    ),
  );
  assert(
    writes.every((r) => r.status === 200),
    JSON.stringify(summarize(writes)),
  );
  assert(writes.every((r) => r.body.quantity === 2));
  const privateList = await request(`/order-lists/${listId}/items`, {
    token: tokens[0],
  });
  assert.equal(privateList.body.meta.total, 1);
  assert.equal(privateList.cacheControl, 'private, no-store');
  const favoriteWrites = await Promise.all(
    Array.from({ length: 25 }, () =>
      request('/favorites/1', { token: tokens[0], method: 'PUT' }),
    ),
  );
  assert(favoriteWrites.every((r) => r.status === 200));
  assert.equal(
    (await request('/favorites/ids', { token: tokens[0] })).body.total,
    1,
  );
  assert.equal(
    (await request('/favorites/ids', { token: tokens[1] })).body.total,
    0,
  );

  const lists = [listId];
  for (let i = 1; i < users; i++) {
    const result = await request('/order-lists', {
      token: tokens[i],
      method: 'POST',
      body: { name: 'Carga' },
    });
    assert.equal(result.status, 201);
    lists.push(result.body.id);
  }

  const burst = async (path) =>
    Promise.all(Array.from({ length: users }, () => request(path)));
  // Namespace y Redis exclusivos del laboratorio; nunca apuntan a un servicio existente.
  await redis.flushdb();
  const cold = summarize(await burst('/products/destacados?limit=12'));
  const warm = summarize(await burst('/products/destacados?limit=12'));
  console.log('Ráfagas fría/caliente:', JSON.stringify({ cold, warm }));
  const samples = [];
  const byRoute = {};
  console.log(
    `Carga mixta: ${users} usuarios durante ${seconds}s, pausa de 1–1.5s entre acciones...`,
  );
  const started = performance.now();
  const deadline = started + seconds * 1000;
  const progress = setInterval(() => {
    console.log(
      `Avance: ${samples.length} solicitudes, ${samples.filter((sample) => sample.status < 200 || sample.status >= 300).length} errores`,
    );
  }, 30000);
  progress.unref();
  await Promise.all(
    tokens.map(async (token, user) => {
      let iteration = 0;
      await sleep((user * 37) % 1000);
      while (performance.now() < deadline) {
        const selector = (user + iteration++) % 10;
        const product = 1 + ((user * 73 + iteration * 17) % 20000);
        const searchPaths = [
          `/products?search=${String(product).padStart(5, '0')}&searchMode=name`,
          `/products?search=Producto%20${String(product).padStart(5, '0').slice(0, 2)}`,
          `/products?search=SKU-${product}&searchMode=skuExact`,
        ];
        const choices = [
          ['catalog', `/products?page=${1 + (user % 20)}&limit=24`],
          [
            'images-first',
            `/products?orderBy=conImagen&page=${1 + (user % 10)}&limit=24`,
          ],
          ['search', searchPaths[iteration % searchPaths.length]],
          ['detail', `/products/${product}`],
          ['brands', `/brands?supplierId=${1 + (user % 20)}`],
          ['featured', '/products/destacados?limit=12'],
          ['favorites-read', '/favorites/ids'],
          ['favorites-write', `/favorites/${product}`, 'PUT'],
          ['lists-read', `/order-lists/${lists[user]}/items`],
          [
            'lists-write',
            `/order-lists/${lists[user]}/items/${product}`,
            'PUT',
            { quantity: 2 },
          ],
        ];
        const [route, path, method, body] = choices[selector];
        let result;
        const begin = performance.now();
        try {
          result = await request(path, { token, method, body });
        } catch {
          result = { status: 0, ms: performance.now() - begin };
        }
        const sample = { status: result.status, ms: result.ms };
        samples.push(sample);
        (byRoute[route] ??= []).push(sample);
        await sleep(1000 + ((user * 13) % 500));
      }
    }),
  );
  const elapsedSeconds = (performance.now() - started) / 1000;
  clearInterval(progress);
  const mixed = {
    ...summarize(samples),
    elapsedSeconds,
    rps: samples.length / elapsedSeconds,
    byRoute: Object.fromEntries(
      Object.entries(byRoute).map(([route, values]) => [
        route,
        summarize(values),
      ]),
    ),
  };
  const redisStats = await redis.info('stats');
  const databaseStats = (
    await pool.query(
      "SELECT numbackends, blks_hit, blks_read FROM pg_stat_database WHERE datname = 'capacity'",
    )
  ).rows[0];
  console.log('Verificando caída y recuperación de Redis...');
  await run('docker', [...compose, 'stop', 'redis']);
  await sleep(2200);
  assert.equal((await request('/health/live')).status, 200);
  assert.equal((await request('/health/ready')).status, 503);
  const redisDown = summarize(await burst('/products?limit=24'));
  await run('docker', [...compose, 'start', 'redis']);
  await waitReady();
  const report = {
    timestamp: new Date().toISOString(),
    loadGeneratorNode: process.version,
    apiRuntime: dockerApi
      ? 'Docker node:22-alpine, 2 CPU, 1 GiB RAM'
      : `host ${process.version}`,
    platform: process.platform,
    logicalCpus: cpus().length,
    hostMemoryGiB: Math.round(totalmem() / 1024 ** 3),
    users,
    fixtureProducts: 20000,
    databasePoolMax: Number(env.DATABASE_POOL_MAX),
    cold,
    warm,
    mixed,
    redisDown,
    databaseStats,
    redisStats,
    correctness: {
      listLimit: true,
      sameItemUpsert: true,
      favoriteIdempotence: true,
      userIsolation: true,
      redisRecovery: true,
    },
    limitations:
      'API, generador y Docker comparten host. JWT/JWKS sintéticos. Sin UI, login, imágenes ni red externa. Cuota por IP elevada solo en laboratorio.',
  };
  await writeFile('reports/capacity.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ cold, warm, mixed, redisDown }, null, 2));
  assert.equal(cold.errors + warm.errors + redisDown.errors, 0);
  assert(mixed.errorRate < 0.01, 'Errores >= 1%');
  assert(mixed.p95Ms < 1000, 'p95 mixto >= 1s');
  assert(mixed.p99Ms < 2000, 'p99 mixto >= 2s');
  console.log('PASS: reports/capacity.json');
} finally {
  if (api && api.exitCode === null) {
    const exited = new Promise((resolve) => api.once('exit', resolve));
    api.kill();
    await exited;
  }
  if (dockerApi && startedCompose && log) {
    await run(
      'docker',
      [...compose, 'logs', '--no-color', 'api'],
      ['ignore', log.fd, log.fd],
    );
  }
  await log?.close();
  jwksServer?.closeAllConnections();
  if (jwksServer?.listening)
    await new Promise((resolve) => jwksServer.close(resolve));
  redis?.disconnect();
  await pool?.end();
  if (startedCompose) await run('docker', [...compose, 'down', '--volumes']);
}
