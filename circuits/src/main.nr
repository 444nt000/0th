mod tests;

use jwt::JWT;
use poseidon::poseidon::bn254::{hash_3, hash_8};

global MAX_DATA_LENGTH: u32 = 1024; // max length of signed data (headerb64 + "." + payloadb64). Fits scope "openid" only, "email profile" can exceed it
global ISS: str<27> = "https://accounts.google.com";
// both are multiples of 31: `pack` fills whole fields
global MAX_AUD_LENGTH: u32 = 93; // Google client ids are ~72 chars: 12 digits, "-", 32 chars, ".apps.googleusercontent.com"
global MAX_NONCE_LENGTH: u32 = 77; // a BN254 field element has at most 77 decimal digits
global MAX_SUB_LENGTH: u32 = 31; // Google sub is up to 21 digits (OIDC allows 255, a longer one fails the circuit)

// Packs 31 bytes per field (248 bits, below the 254-bit BN254 modulus, so no wrap-around).
// Bytes at or after `len` are ignored: the extracted value is prover-supplied, so a prover could put garbage there.
// Without this, sub "123" plus garbage "45" would hash like sub "12345".
fn pack<let N: u32>(bytes: BoundedVec<u8, N>) -> [Field; N / 31] {
    std::static_assert(N % 31 == 0, "N must be a multiple of 31");
    let mut out = [0; N / 31];
    for i in 0..N / 31 {
        let mut acc: Field = 0;
        for j in 0..31 {
            let k = i * 31 + j;
            let byte = if k < bytes.len() {
                bytes.storage()[k]
            } else {
                0
            };
            acc = acc * 256 + byte as Field;
        }
        out[i] = acc;
    }
    out
}

// Reads the nonce string as a decimal number. The browser sends the Poseidon hash in decimal, Google copies it into the letter.
// Bytes at or after `len` are ignored, as in `pack`.
fn parse_decimal<let N: u32>(digits: BoundedVec<u8, N>) -> Field {
    let mut acc: Field = 0;
    for i in 0..N {
        if i < digits.len() {
            let d = digits.storage()[i];
            assert((d >= 48) & (d <= 57), "nonce is not a decimal number");
            acc = acc * 10 + (d - 48) as Field;
        }
    }
    acc
}

// Layout is fixed: every input has its own slot, so two different (aud, sub) pairs can never give the same inputs.
// Lengths are hashed too, so a trailing zero byte cannot pass for an end of value.
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

fn main(
    data: BoundedVec<u8, MAX_DATA_LENGTH>,
    base64_decode_offset: u32,
    pubkey_modulus_limbs: pub [u128; 18],
    redc_params_limbs: [u128; 18],
    signature_limbs: [u128; 18],
    salt: Field,
    session_pubkey: pub Field,
    expiry: pub u64,
    secret: Field,
) -> pub Field {
    let jwt = JWT::init(
        data,
        base64_decode_offset,
        pubkey_modulus_limbs,
        redc_params_limbs,
        signature_limbs,
    );

    // decoding must start at the payload: a shifted start decodes bit-shifted bytes, unescaped and shaped by the prover.
    // base64url has no ".", so the one "." in the signed data is the header/payload separator.
    assert(data.storage()[base64_decode_offset - 1] == 46, "decode must start at the payload");

    jwt.verify();

    jwt.assert_claim_string("iss".as_bytes(), BoundedVec::<u8, 27>::from_array(ISS.as_bytes()));

    let aud = jwt.get_claim_string::<3, MAX_AUD_LENGTH>("aud".as_bytes());
    let sub = jwt.get_claim_string::<3, MAX_SUB_LENGTH>("sub".as_bytes());

    // the letter must carry H(session key, expiry, secret): it approves this key until this expiry
    let nonce = jwt.get_claim_string::<5, MAX_NONCE_LENGTH>("nonce".as_bytes());
    assert(
        parse_decimal(nonce) == hash_3([session_pubkey, expiry as Field, secret]),
        "nonce does not match the session key",
    );

    identity_hash(aud, sub, salt)
}
