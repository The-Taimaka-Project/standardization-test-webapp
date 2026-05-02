import crypto from 'node:crypto';

/**
 * AES-256-GCM token encryption. Key is loaded from TOKEN_ENCRYPTION_KEY (64
 * hex chars = 32 bytes). Output format: <iv hex>:<auth tag hex>:<ciphertext
 * hex>. Same shape on the way back; nothing else parses these strings.
 */

function key(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY missing or not 64 hex chars (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decrypt(blob: string): string {
  const [ivHex, tagHex, ctHex] = blob.split(':');
  if (!ivHex || !tagHex || !ctHex) throw new Error('malformed encrypted token');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
