import { generateKeyPairSync } from 'node:crypto';

/**
 * A throwaway RSA key pair for exercising GitHub App JWT signing.
 *
 * Generated at import time rather than committed as a fixture: a PEM private
 * key checked into a repository is indistinguishable from a leaked one at a
 * glance, and every secret scanner in existence will flag it. Generating one
 * costs a few milliseconds once per run and cannot be mistaken for a real
 * credential.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

export const TEST_PRIVATE_KEY = privateKey;
export const TEST_PUBLIC_KEY = publicKey;
