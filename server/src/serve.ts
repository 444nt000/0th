// POST /salt { jwt } -> { salt }, derived as HKDF(seed, sub): the dev's one secret
// POST /relay { constructorCalldata, proof } -> { address }, pays deploy + register_session
