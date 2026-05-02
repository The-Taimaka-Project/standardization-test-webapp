import fs from 'node:fs';

function loadDevCreds() {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync('dev_odk.creds', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const c = loadDevCreds();
const base = c.BASE_URL ?? 'https://taimaka-internal.org:7443';

async function call(path: string, token: string) {
  const r = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
  console.log(`GET ${path} -> ${r.status}`);
  const txt = await r.text();
  console.log('   ', txt.slice(0, 600));
}

(async () => {
  const r = await fetch(base + '/v1/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: c.USER, password: c.PASSWORD }),
  });
  const j = (await r.json()) as { token: string };
  const t = j.token;
  await call('/v1/projects', t);
  await call(`/v1/projects/${c.PROJECT}`, t);
  await call(`/v1/projects/${c.PROJECT}/forms`, t);
})();
