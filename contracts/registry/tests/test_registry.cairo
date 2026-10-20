// Project
use registry::registry::{IKeyRegistryDispatcher, IKeyRegistryDispatcherTrait, MAX_AGE};

// Snforge
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp,
    start_cheat_caller_address,
};

// Starknet
use starknet::{ContractAddress, SyscallResultTrait};

const ADMIN: ContractAddress = 'owner'.try_into().unwrap();
const STRANGER: ContractAddress = 'stranger'.try_into().unwrap();
const NOW: u64 = 1760000000;

/// Deploys a registry owned by ADMIN
fn deploy_registry() -> IKeyRegistryDispatcher {
    let contract = declare("Registry").unwrap_syscall().contract_class();
    let mut calldata = array![];
    Serde::serialize(@ADMIN, ref calldata);
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();
    IKeyRegistryDispatcher { contract_address }
}

#[test]
fn test_renew_and_remove_key() {
    let registry = deploy_registry();
    let key = array![1_u256, 2].span();
    start_cheat_block_timestamp(registry.contract_address, NOW);
    start_cheat_caller_address(registry.contract_address, ADMIN);

    // Renew the key
    registry.renew_key(key);

    // Only the renewed key is valid
    assert!(registry.is_key(key));
    assert!(!registry.is_key(array![1_u256, 3].span()));

    // Remove the key
    registry.remove_key(key);

    assert!(!registry.is_key(key));
}

#[test]
fn test_key_goes_stale_unrenewed() {
    let registry = deploy_registry();
    let key = array![1_u256, 2].span();
    start_cheat_block_timestamp(registry.contract_address, NOW);
    start_cheat_caller_address(registry.contract_address, ADMIN);

    registry.renew_key(key);

    // The key is still valid one second before MAX_AGE
    start_cheat_block_timestamp(registry.contract_address, NOW + MAX_AGE - 1);
    assert!(registry.is_key(key));

    // The key is no longer valid at MAX_AGE
    start_cheat_block_timestamp(registry.contract_address, NOW + MAX_AGE);
    assert!(!registry.is_key(key));
}

#[test]
fn test_renewal_extends_a_live_key() {
    let registry = deploy_registry();
    let key = array![1_u256, 2].span();
    start_cheat_block_timestamp(registry.contract_address, NOW);
    start_cheat_caller_address(registry.contract_address, ADMIN);

    registry.renew_key(key);

    // Renew the key one day before it would have gone stale
    let later = NOW + MAX_AGE - 24 * 3600;
    start_cheat_block_timestamp(registry.contract_address, later);
    registry.renew_key(key);

    // The key gets 30 more days from the second renewal, not the first
    start_cheat_block_timestamp(registry.contract_address, NOW + MAX_AGE);
    assert!(registry.is_key(key));

    start_cheat_block_timestamp(registry.contract_address, later + MAX_AGE);
    assert!(!registry.is_key(key));
}

#[test]
fn test_unknown_key_is_not_live_at_any_time() {
    let registry = deploy_registry();
    let key = array![1_u256, 2].span();

    // A key never renewed reads 0, and 0 + MAX_AGE would pass as fresh, so is_key must reject it
    start_cheat_block_timestamp(registry.contract_address, 0);
    assert!(!registry.is_key(key));

    start_cheat_block_timestamp(registry.contract_address, MAX_AGE - 1);
    assert!(!registry.is_key(key));
}

#[test]
#[should_panic(expected: ('Caller is missing role', 'ENTRYPOINT_FAILED'))]
fn test_renew_key_not_admin() {
    let registry = deploy_registry();

    start_cheat_caller_address(registry.contract_address, STRANGER);
    registry.renew_key(array![1_u256, 2].span()); // (must panic)
}

#[test]
#[should_panic(expected: ('Caller is missing role', 'ENTRYPOINT_FAILED'))]
fn test_remove_key_not_admin() {
    let registry = deploy_registry();

    start_cheat_caller_address(registry.contract_address, STRANGER);
    registry.remove_key(array![1_u256, 2].span()); // (must panic)
}
