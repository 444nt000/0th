// Project
use registry::registry::{IKeyRegistryDispatcher, IKeyRegistryDispatcherTrait};

// Snforge
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address};

// Starknet
use starknet::{ContractAddress, SyscallResultTrait};

const ADMIN: ContractAddress = 'owner'.try_into().unwrap();
const STRANGER: ContractAddress = 'stranger'.try_into().unwrap();

fn deploy_registry() -> IKeyRegistryDispatcher {
    let contract = declare("Registry").unwrap_syscall().contract_class();
    let mut calldata = array![];
    Serde::serialize(@ADMIN, ref calldata);
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();
    IKeyRegistryDispatcher { contract_address }
}

#[test]
fn test_add_and_remove_key() {
    let registry = deploy_registry();
    let key = array![1_u256, 2].span();

    start_cheat_caller_address(registry.contract_address, ADMIN);
    registry.add_key(key);

    assert!(registry.is_key(key));
    assert!(!registry.is_key(array![1_u256, 3].span()));

    registry.remove_key(key);

    assert!(!registry.is_key(key));
}

#[test]
#[should_panic(expected: ('Caller is missing role', 'ENTRYPOINT_FAILED'))]
fn test_add_key_not_admin() {
    let registry = deploy_registry();

    start_cheat_caller_address(registry.contract_address, STRANGER);
    registry.add_key(array![1_u256, 2].span()); // (must panic)
}
