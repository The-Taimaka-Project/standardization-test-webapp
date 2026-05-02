/**
 * Thin client for ODK Central. Token mgmt + submissions pull.
 *
 * Auth: POST /v1/sessions returns a session token (string). Token expiry is
 * roughly 24 hours; we treat it as opaque, store it encrypted, and re-prompt
 * the user for their password when a request 401s.
 *
 * Submissions are pulled via the OData feed:
 *   GET /v1/projects/{p}/forms/{f}.svc/Submissions
 * with `$filter=__system/submissionDate ge YYYY-MM-DDT00:00:00Z` to limit
 * the result set, and pagination via @odata.nextLink.
 */

export interface OdkConfig {
  baseUrl: string;
  email: string;
  /** Either a fresh password (for token exchange) or a stored token. */
  password?: string;
  token?: string;
}

export class OdkAuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'OdkAuthError';
  }
}

function trimBase(u: string) {
  return u.replace(/\/+$/, '');
}

/** Given a YYYY-MM-DD string, returns the next day's YYYY-MM-DD (UTC). */
function addOneDayUtc(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function exchangeToken(baseUrl: string, email: string, password: string): Promise<string> {
  const r = await fetch(`${trimBase(baseUrl)}/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (r.status === 401) throw new OdkAuthError('ODK Central rejected those credentials.');
  if (!r.ok) throw new Error(`ODK /v1/sessions returned ${r.status}: ${await r.text()}`);
  const json = (await r.json()) as { token?: string };
  if (!json.token) throw new Error('ODK Central did not return a token');
  return json.token;
}

interface OdataPage<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

export interface OdkSubmission {
  __id: string;
  __system?: { submissionDate?: string; reviewState?: string | null };
  enumerator_id?: number | string | null;
  round?: number | string | null;
  group?: number | string | null;
  child_id?: number | string | null;
  age?: number | string | null;
  muac_measurement?: number | string | null;
  child_stand?: string | null;
  ptonly_weight?: number | string | null;
  cg_weight?: number | string | null;
  pt_weight?: number | string | null;
  weight?: number | string | null;
  hl_measurement?: number | string | null;
  hl?: number | string | null;
  direction_of_measure?: string | null;
  // Carry-through for any unknown fields the form adds later.
  [key: string]: unknown;
}

/**
 * Pull submissions for a form whose `submissionDate` falls on the given UTC
 * day. We use a half-open `[date, date+1)` window so the test day is fully
 * captured and the next day is not.
 *
 * Submissions whose ODK Central review state is `rejected` are split out
 * and counted, not returned. The webapp surfaces that count in the heads-up
 * panel so the operator knows how many forms were dropped.
 *
 * Throws OdkAuthError on 401 so the caller can prompt the user to re-enter
 * their password.
 */
export async function fetchSubmissions(
  cfg: OdkConfig,
  projectId: number,
  formId: string,
  pullFromDate: string, // YYYY-MM-DD — the test day
): Promise<{ submissions: OdkSubmission[]; rejectedCount: number }> {
  if (!cfg.token) throw new Error('ODK token missing — caller must obtain one first.');
  const nextDay = addOneDayUtc(pullFromDate);
  const filter =
    `__system/submissionDate ge ${pullFromDate}T00:00:00Z` +
    ` and __system/submissionDate lt ${nextDay}T00:00:00Z`;
  const startUrl =
    `${trimBase(cfg.baseUrl)}/v1/projects/${projectId}/forms/${encodeURIComponent(formId)}.svc/Submissions` +
    `?$filter=${encodeURIComponent(filter)}&$top=500`;

  const submissions: OdkSubmission[] = [];
  let rejectedCount = 0;
  let next: string | undefined = startUrl;
  while (next) {
    const r: Response = await fetch(next, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
    });
    if (r.status === 401) throw new OdkAuthError('ODK token expired or revoked.');
    if (!r.ok) {
      throw new Error(`ODK submissions fetch failed (${r.status}): ${await r.text()}`);
    }
    const page = (await r.json()) as OdataPage<OdkSubmission>;
    for (const sub of page.value ?? []) {
      if (sub.__system?.reviewState === 'rejected') {
        rejectedCount++;
        continue;
      }
      submissions.push(sub);
    }
    next = page['@odata.nextLink'];
  }
  return { submissions, rejectedCount };
}

/**
 * Ask ODK Central to mint an Enketo edit URL for the given submission. The
 * endpoint is GET /v1/projects/{p}/forms/{f}/submissions/{instanceId}/edit.
 * Central returns a 302 whose Location header is the Enketo edit URL. We
 * surface that URL to the caller so the browser can open it in a new tab.
 *
 * Auth: the user's ODK token must have submission.update on the project
 * (e.g. Project Manager). Read-only accounts will get 403 here.
 */
export async function requestEditUrl(
  cfg: OdkConfig,
  projectId: number,
  formId: string,
  instanceId: string,
): Promise<string> {
  if (!cfg.token) throw new Error('ODK token missing — caller must obtain one first.');
  const url =
    `${trimBase(cfg.baseUrl)}/v1/projects/${projectId}/forms/${encodeURIComponent(formId)}` +
    `/submissions/${encodeURIComponent(instanceId)}/edit`;
  const r = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cfg.token}` },
    redirect: 'manual',
  });
  if (r.status === 401) throw new OdkAuthError('ODK token expired or revoked.');
  if (r.status === 403) {
    throw new Error(
      'Your ODK account does not have permission to edit submissions on this project. ' +
      'Sign in with an account that has Project Manager (or equivalent) rights, or ask ' +
      'an admin to grant submission.update.',
    );
  }
  if (r.status >= 300 && r.status < 400) {
    const loc = r.headers.get('location');
    if (loc) return loc;
  }
  if (r.ok) {
    // Some Central versions return JSON instead of a redirect.
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const json = (await r.json()) as { url?: string };
      if (json.url) return json.url;
    }
  }
  throw new Error(`ODK edit URL request failed (${r.status}): ${await r.text()}`);
}
