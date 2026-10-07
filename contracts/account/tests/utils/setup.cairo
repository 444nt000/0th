// Project
use account::account::IAccountDispatcher;
use registry::registry::{IKeyRegistryDispatcher, IKeyRegistryDispatcherTrait};

// Snforge
use snforge_std::{
    start_cheat_block_timestamp_global, start_cheat_caller_address, stop_cheat_caller_address,
};

// Tests
use crate::utils::helpers::{
    ADMIN, EXPIRY, IDENTITY_INPUT, MODULUS_LIMBS, deploy_contract, load_proof, public_inputs,
};

pub fn setup(
    verifier: ByteArray, identity_hash: u256, with_key: bool,
) -> (IAccountDispatcher, IKeyRegistryDispatcher) {
    // Clock: one day before the fixture expires, tests move it when they need to
    start_cheat_block_timestamp_global(EXPIRY - 24 * 3600);

    // Registry
    let mut calldata = array![];
    Serde::serialize(@ADMIN, ref calldata);
    let contract_address = deploy_contract("Registry", calldata);
    let registry = IKeyRegistryDispatcher { contract_address };
    if with_key {
        let inputs = public_inputs(load_proof().span());
        start_cheat_caller_address(registry.contract_address, ADMIN);
        registry.add_key(inputs.span().slice(0, MODULUS_LIMBS));
        stop_cheat_caller_address(registry.contract_address);
    }

    // Verifier
    let verifier_address = deploy_contract(verifier, array![]);

    // Account
    let mut calldata = array![];
    Serde::serialize(@ADMIN, ref calldata);
    Serde::serialize(@registry.contract_address, ref calldata);
    Serde::serialize(@verifier_address, ref calldata);
    Serde::serialize(@identity_hash, ref calldata);
    let contract_address = deploy_contract("Account", calldata);

    (IAccountDispatcher { contract_address }, registry)
}

pub fn fixture_identity() -> u256 {
    *public_inputs(load_proof().span())[IDENTITY_INPUT]
}
