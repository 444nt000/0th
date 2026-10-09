// Core
use core::num::traits::Zero;

// Snforge
use snforge_std::fs::{FileTrait, read_txt};
use snforge_std::signature::stark_curve::{StarkCurveKeyPairImpl, StarkCurveSignerImpl};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    start_cheat_signature_global, start_cheat_transaction_hash_global,
    start_cheat_transaction_version_global,
};

// Starknet
use starknet::{ContractAddress, SyscallResultTrait};

// Accounts
pub const ADMIN: ContractAddress = 'ADMIN'.try_into().unwrap();
pub const STRANGER: ContractAddress = 'STRANGER'.try_into().unwrap();

// From circuits/scripts/fixture.ts
pub const EXPIRY: u64 = 1800000000;
pub const SESSION_PRIVKEY: felt252 = 0x1234567890abcdef;

pub const TX_HASH: felt252 = 'TX_HASH';

// Public inputs of the circuit, in order
pub const MODULUS_LIMBS: u32 = 18;
pub const SESSION_KEY_INPUT: u32 = 18;
pub const IDENTITY_INPUT: u32 = 20;

pub fn deploy_contract(name: ByteArray, calldata: Array<felt252>) -> ContractAddress {
    let contract = declare(name).unwrap_syscall().contract_class();
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();
    contract_address
}

/// Loads the Garaga calldata of the circuit's proof fixture (make verifier)
pub fn load_proof() -> Array<felt252> {
    read_txt(@FileTrait::new("../verifier/tests/proof_calldata.txt"))
}

/// Reads the public inputs at the start of a proof's calldata: `count, (low, high) * count`
pub fn public_inputs(proof: Span<felt252>) -> Array<u256> {
    let count: u32 = (*proof[0]).try_into().unwrap();
    let mut inputs = array![];
    for i in 0..count {
        let low = (*proof[1 + 2 * i]).try_into().unwrap();
        let high = (*proof[2 + 2 * i]).try_into().unwrap();
        inputs.append(u256 { low, high });
    }
    inputs
}

/// Encodes public inputs as a proof for the MockVerifier
pub fn mock_proof(inputs: Span<u256>) -> Array<felt252> {
    let mut proof = array![inputs.len().into()];
    for input in inputs {
        proof.append((*input.low).into());
        proof.append((*input.high).into());
    }
    proof
}

/// Copies the inputs with the one at index replaced
pub fn replace_input(inputs: Span<u256>, index: u32, value: u256) -> Array<u256> {
    let mut copy = array![];
    for i in 0..inputs.len() {
        copy.append(if i == index {
            value
        } else {
            *inputs[i]
        });
    }
    copy
}

/// The session key the proof registers (public input 18)
pub fn session_key(inputs: Span<u256>) -> felt252 {
    (*inputs[SESSION_KEY_INPUT]).try_into().unwrap()
}

/// Signs a tx hash with the fixture session key, as the account expects: `[session_key, r, s]`
pub fn session_signature(tx_hash: felt252) -> Array<felt252> {
    let key_pair = StarkCurveKeyPairImpl::from_secret_key(SESSION_PRIVKEY);
    let (r, s) = key_pair.sign(tx_hash).unwrap();
    array![key_pair.public_key, r, s]
}

/// Makes the next calls to the account look like a transaction sent by the protocol
pub fn cheat_tx(account: ContractAddress, signature: Span<felt252>) {
    start_cheat_transaction_hash_global(TX_HASH);
    start_cheat_signature_global(signature);
    start_cheat_transaction_version_global(3);
    start_cheat_caller_address(account, Zero::zero());
}
