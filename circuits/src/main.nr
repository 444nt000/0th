mod tests;

use jwt::JWT;
use poseidon::poseidon::bn254::{hash_3, hash_8};

// Max size of "header.payload" (base64). Fits scope "openid" only
global MAX_DATA_LENGTH: u32 = 1024;
global ISS: str<27> = "https://accounts.google.com";
// Multiples of 31: pack cuts text into 31-byte pieces
global MAX_AUD_LENGTH: u32 = 93; // Google client ids are ~72 chars
global MAX_NONCE_LENGTH: u32 = 77; // a Field has at most 77 decimal digits
global MAX_SUB_LENGTH: u32 = 31; // Google's sub is 21 digits

// Packs text into Fields for Poseidon, 31 bytes each (32 could overflow a Field).
// Bytes after len count as 0. noir-jwt does not check them, so a prover could make "123" pack like "12345"
fn pack<let N: u32>(bytes: BoundedVec<u8, N>) -> [Field; N / 31] {
    std::static_assert(N % 31 == 0, "N must be a multiple of 31");
    let mut out = [0; N / 31];
    for i in 0..N / 31 {
        let mut acc: Field = 0;
        for j in 0..31 {
            let k = i * 31 + j;
            let byte = if k < bytes.len() {
                bytes.get_unchecked(k)
            } else {
                0
            };
            acc = acc * 256 + byte as Field;
        }
        out[i] = acc;
    }
    out
}

// Reads the nonce text as a number. Bytes after len are ignored, as in pack.
// ASCII 48 to 57 are "0" to "9"
fn parse_decimal<let N: u32>(digits: BoundedVec<u8, N>) -> Field {
    let mut acc: Field = 0;
    for i in 0..N {
        if i < digits.len() {
            let d = digits.get_unchecked(i);
            assert((d >= 48) & (d <= 57), "nonce is not a decimal number");
            acc = acc * 10 + (d - 48) as Field;
        }
    }
    acc
}

// The account's identity: H(iss, aud, sub, salt).
// The browser recomputes it to find the address, so this layout must never change.
// Lengths are hashed because pack pads with 0 bytes
fn identity_hash(
    aud: BoundedVec<u8, MAX_AUD_LENGTH>,
    sub: BoundedVec<u8, MAX_SUB_LENGTH>,
    salt: Field,
) -> Field {
    let iss = pack(BoundedVec::<u8, 31>::from_array(ISS.as_bytes()));
    let aud_fields = pack(aud);
    let sub_fields = pack(sub);
    hash_8([
        iss[0],
        aud_fields[0],
        aud_fields[1],
        aud_fields[2],
        aud.len() as Field,
        sub_fields[0],
        sub.len() as Field,
        salt,
    ])
}

// Proves Google signed a JWT approving session_pubkey until expiry.
// Returns the account's identity_hash
fn main(
    // "header.payload" (base64), the part Google signed
    data: BoundedVec<u8, MAX_DATA_LENGTH>,
    // where the payload starts in data
    base64_decode_offset: u32,
    // Google's RSA key. The contract checks it against the registry
    pubkey_modulus_limbs: pub [u128; 18],
    // derived from the key, only speeds up proving. A wrong value cannot fake a proof
    redc_params_limbs: [u128; 18],
    // Google's RSA signature over data
    signature_limbs: [u128; 18],
    // from the dev's server: hides which Google user owns the account
    salt: Field,
    // temporary key the browser made at login
    session_pubkey: pub Field,
    // session end (Unix seconds)
    expiry: pub u64,
    // random, from the browser: hides the session key from Google
    secret: Field,
) -> pub Field {
    let jwt = JWT::init(
        data,
        base64_decode_offset,
        pubkey_modulus_limbs,
        redc_params_limbs,
        signature_limbs,
    );

    jwt.verify();

    // Decoding must start right after the "." (ASCII 46).
    // A shifted start gives scrambled text a cheater could shape into a fake "sub".
    // Base64 has no ".", so data has only one. `get` also rejects a "." planted after len
    assert(data.get(base64_decode_offset - 1) == 46, "decode must start at the payload");

    jwt.assert_claim_string("iss".as_bytes(), BoundedVec::<u8, 27>::from_array(ISS.as_bytes()));
    let aud = jwt.get_claim_string::<3, MAX_AUD_LENGTH>("aud".as_bytes());
    let sub = jwt.get_claim_string::<3, MAX_SUB_LENGTH>("sub".as_bytes());

    // nonce = H(session key, expiry, secret). Google signed it, so it vouches for the key and expiry
    let nonce = jwt.get_claim_string::<5, MAX_NONCE_LENGTH>("nonce".as_bytes());
    assert(
        parse_decimal(nonce) == hash_3([session_pubkey, expiry as Field, secret]),
        "nonce does not match the session key",
    );

    identity_hash(aud, sub, salt)
}
