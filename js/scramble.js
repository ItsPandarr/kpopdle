// Light obfuscation used for both the data payload and the localStorage blob.
// Goal: a casual snooper opening DevTools shouldn't see the daily answer or
// the dataset in plain text. NOT security — anyone determined can run the
// same XOR-then-base64 to peek.
//
// The XOR mask is named like a build identifier and uses an app-name string,
// so in the minified bundle it just looks like incidental metadata rather
// than something with "key" or "secret" in it. Keep this string in sync with
// scripts/encode_data.py (otherwise data/*.dat won't decode).

const BUILD_ID = new TextEncoder().encode("KPopdle 2.6.0");

function xor(bytes) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ BUILD_ID[i % BUILD_ID.length];
  }
  return out;
}

export function scramble(str) {
  const bytes = new TextEncoder().encode(str);
  const x = xor(bytes);
  // btoa expects a latin-1 string; map bytes 1:1 into char codes.
  let bin = "";
  for (let i = 0; i < x.length; i++) bin += String.fromCharCode(x[i]);
  return btoa(bin);
}

export function unscramble(b64) {
  const bin = atob(b64.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(xor(bytes));
}
