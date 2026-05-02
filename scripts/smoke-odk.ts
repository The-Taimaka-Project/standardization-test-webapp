import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { exchangeToken, fetchSubmissions } from '@/lib/odk/client';
import { normalize } from '@/lib/odk/normalize';

function loadDevCreds(): Record<string, string> {
  const file = path.resolve('dev_odk.creds');
  if (!fs.existsSync(file)) throw new Error(`${file} not found`);
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

async function main() {
  const c = loadDevCreds();
  const baseUrl = c.BASE_URL ?? process.env.ODK_DEFAULT_BASE_URL ?? 'https://taimaka-internal.org:7443';
  const project = parseInt(c.PROJECT, 10);
  const form = c.FORM;

  console.log(`Exchanging token for ${c.USER} on ${baseUrl}…`);
  const token = await exchangeToken(baseUrl, c.USER, c.PASSWORD);
  console.log(`OK, token length=${token.length}.`);

  // Pull a recent slice — last 30 days — to see real shape.
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  console.log(`Pulling project ${project} form ${form} since ${since}…`);
  const subs = await fetchSubmissions(
    { baseUrl, email: c.USER, token },
    project,
    form,
    since,
  );
  console.log(`Fetched ${subs.length} submission(s).`);
  if (subs.length > 0) {
    const sample = subs[0];
    console.log('First submission keys:', Object.keys(sample).slice(0, 30));
    console.log('Normalized sample:', normalize(sample));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
