use crate::{identity_hash, MAX_AUD_LENGTH, MAX_SUB_LENGTH, pack, parse_decimal};

#[test]
fn pack_ignores_bytes_after_len() {
    // same 3 bytes, one copy with garbage after len
    let mut clean = [0; 31];
    clean[0] = 1;
    clean[1] = 2;
    clean[2] = 3;
    let mut dirty = clean;
    dirty[3] = 9;

    // pack both
    // (from_parts would zero the garbage, from_parts_unchecked keeps it like a prover-supplied value)
    let a = pack(BoundedVec::from_parts_unchecked(clean, 3));
    let b = pack(BoundedVec::from_parts_unchecked(dirty, 3));

    // same fields
    assert_eq(a, b);
}

#[test]
fn identity_hash_differs_per_aud_and_sub() {
    // a base login and variants changing one field each
    let aud = BoundedVec::<u8, MAX_AUD_LENGTH>::from_array("aud1".as_bytes());
    let sub = BoundedVec::<u8, MAX_SUB_LENGTH>::from_array("123".as_bytes());
    let base = identity_hash(aud, sub, 7);

    // change aud, then sub (the original is a prefix of it), then salt
    let other_aud = BoundedVec::<u8, MAX_AUD_LENGTH>::from_array("aud2".as_bytes());
    let longer_sub = BoundedVec::<u8, MAX_SUB_LENGTH>::from_array("1230".as_bytes());

    // each change gives a different hash, same inputs give the same hash
    assert(identity_hash(other_aud, sub, 7) != base);
    assert(identity_hash(aud, longer_sub, 7) != base);
    assert(identity_hash(aud, sub, 8) != base);
    assert(identity_hash(aud, sub, 7) == base);
}

#[test]
fn parse_decimal_reads_number_and_ignores_bytes_after_len() {
    // "123" followed by garbage after len
    let mut storage = [0; 77];
    storage[0] = 49;
    storage[1] = 50;
    storage[2] = 51;
    storage[3] = 57;

    // parse
    let n = parse_decimal(BoundedVec::from_parts_unchecked(storage, 3));

    // 123
    assert_eq(n, 123);
}

#[test(should_fail_with = "nonce is not a decimal number")]
fn parse_decimal_rejects_non_digit() {
    // "1x"
    let mut storage = [0; 77];
    storage[0] = 49;
    storage[1] = 120;

    // parse (must panic)
    let _ = parse_decimal(BoundedVec::from_parts_unchecked(storage, 2));
}
