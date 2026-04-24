/** Tiny crypto-random id helper. Uses base32 for terminal-friendly output. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function randomId(bytes = 12): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < arr.length; i++) out += ALPHABET[arr[i] % ALPHABET.length];
  return out;
}

export function randomCode(len = 6): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[arr[i] % ALPHABET.length];
  return out;
}
