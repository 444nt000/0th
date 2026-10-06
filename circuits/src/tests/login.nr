use crate::main;
use super::fixtures::{
    EXPIRY, GOOGLE, IDENTITY_HASH, Letter, OTHER_ISS, SALT, SECRET, SESSION_PUBKEY,
};

fn login(letter: Letter, expiry: u64, base64_decode_offset: u32) -> Field {
    main(
        // unchecked keeps bytes past len, like a prover-supplied input
        BoundedVec::from_parts_unchecked(letter.data, letter.data_len),
        base64_decode_offset,
        letter.pubkey_modulus_limbs,
        letter.redc_params_limbs,
        letter.signature_limbs,
        SALT,
        SESSION_PUBKEY,
        expiry,
        SECRET,
    )
}

#[test]
fn accepts_google_letter() {
    // log in with the valid letter
    let identity = login(GOOGLE, EXPIRY, GOOGLE.base64_decode_offset);

    // same identity hash as computed off-circuit
    assert_eq(identity, IDENTITY_HASH);
}

#[test(should_fail)]
fn rejects_tampered_payload() {
    // change one payload byte after signing (inside jti, so claims still parse)
    let mut letter = GOOGLE;
    letter.data[GOOGLE.data_len - 10] += 1;

    // log in with the tampered letter (must panic)
    let _ = login(letter, EXPIRY, GOOGLE.base64_decode_offset);
}

#[test(should_fail_with = "incorrect value for claim")]
fn rejects_other_iss() {
    // log in with a letter whose iss is not Google (must panic)
    let _ = login(OTHER_ISS, EXPIRY, OTHER_ISS.base64_decode_offset);
}

#[test(should_fail_with = "nonce does not match the session key")]
fn rejects_stretched_expiry() {
    // log in with an expiry past the one the nonce approves (must panic)
    let _ = login(GOOGLE, EXPIRY + 1, GOOGLE.base64_decode_offset);
}

#[test(should_fail_with = "decode must start at the payload")]
fn rejects_shifted_offset() {
    // log in with decoding started 4 bytes into the payload (must panic)
    let _ = login(GOOGLE, EXPIRY, GOOGLE.base64_decode_offset + 4);
}
