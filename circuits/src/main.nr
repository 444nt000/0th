use jwt::JWT;

global MAX_DATA_LENGTH: u32 = 1024; // max length of signed data (headerb64 + "." + payloadb64)

fn main(
    data: BoundedVec<u8, MAX_DATA_LENGTH>,
    base64_decode_offset: u32,
    pubkey_modulus_limbs: pub [u128; 18],
    redc_params_limbs: [u128; 18],
    signature_limbs: [u128; 18],
) {
    let jwt = JWT::init(
        data,
        base64_decode_offset,
        pubkey_modulus_limbs,
        redc_params_limbs,
        signature_limbs,
    );

    jwt.verify();
}
