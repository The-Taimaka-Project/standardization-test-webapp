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

(async () => {
  const r = await fetch(base + '/v1/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: c.USER, password: c.PASSWORD }),
  });
  const t = ((await r.json()) as { token: string }).token;

  // First, fetch one submission instanceId from the form so we have a real one to probe with.
  const subsResp = await fetch(
    `${base}/v1/projects/${c.PROJECT}/forms/${encodeURIComponent(c.FORM)}/submissions?$top=1`,
    { headers: { Authorization: `Bearer ${t}` } },
  );
  const subs = (await subsResp.json()) as Array<{ instanceId: string }>;
  const instanceId = subs[0]?.instanceId;
  console.log('instanceId =', instanceId);
  if (!instanceId) return;

  // Probe the various endpoint shapes ODK Central has used over versions.
  const variants: { method: 'GET' | 'POST'; path: string; accept?: string }[] = [
    { method: 'POST', path: `/v1/projects/${c.PROJECT}/forms/${encodeURIComponent(c.FORM)}/submissions/${encodeURIComponent(instanceId)}/edit` },
    { method: 'GET',  path: `/v1/projects/${c.PROJECT}/forms/${encodeURIComponent(c.FORM)}/submissions/${encodeURIComponent(instanceId)}/edit` },
    { method: 'GET',  path: `/v1/projects/${c.PROJECT}/forms/${encodeURIComponent(c.FORM)}/submissions/${encodeURIComponent(instanceId)}/edit`, accept: 'application/json' },
    { method: 'GET',  path: `/v1/projects/${c.PROJECT}/forms/${encodeURIComponent(c.FORM)}/submissions/${encodeURIComponent(instanceId)}` },
    { method: 'GET',  path: `/v1/projects/${c.PROJECT}/forms/${encodeURIComponent(c.FORM)}.svc/Submissions('${encodeURIComponent(instanceId)}')` },
  ];

  for (const v of variants) {
    const headers: Record<string, string> = { Authorization: `Bearer ${t}` };
    if (v.accept) headers.Accept = v.accept;
    const r = await fetch(base + v.path, { method: v.method, headers, redirect: 'manual' });
    const text = await r.text().catch(() => '');
    console.log(`${v.method} ${v.path}`);
    console.log(`  -> ${r.status}${r.headers.get('location') ? ` (Location: ${r.headers.get('location')})` : ''}`);
    if (text) console.log('  body:', text.slice(0, 500));
  }
})();
