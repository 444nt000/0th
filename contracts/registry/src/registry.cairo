pub const MAX_AGE: u64 = 30 * 24 * 3600; // a key not renewed for 30 days stops being valid

#[starknet::interface]
pub trait IKeyRegistry<TContractState> {
    fn is_key(self: @TContractState, modulus: Span<u256>) -> bool;
    fn renew_key(ref self: TContractState, modulus: Span<u256>);
    fn remove_key(ref self: TContractState, modulus: Span<u256>);
}

#[starknet::contract]
pub mod Registry {
    // Core
    use core::poseidon::poseidon_hash_span;

    // OpenZeppelin
    use openzeppelin_access::accesscontrol::{AccessControlComponent, DEFAULT_ADMIN_ROLE};
    use openzeppelin_introspection::src5::SRC5Component;

    // Starknet
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::{ContractAddress, get_block_timestamp};
    use super::MAX_AGE;

    pub const ADMIN_ROLE: felt252 = DEFAULT_ADMIN_ROLE;

    component!(path: AccessControlComponent, storage: accesscontrol, event: AccessControlEvent);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    #[abi(embed_v0)]
    impl AccessControlImpl =
        AccessControlComponent::AccessControlImpl<ContractState>;
    impl AccessControlInternalImpl = AccessControlComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        accesscontrol: AccessControlComponent::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
        keys: Map<felt252, u64> // poseidon hash of the modulus limbs to its last renewal time
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.accesscontrol.initializer();
        self.accesscontrol._grant_role(ADMIN_ROLE, owner);
    }

    #[abi(embed_v0)]
    impl KeyRegistryImpl of super::IKeyRegistry<ContractState> {
        fn is_key(self: @ContractState, modulus: Span<u256>) -> bool {
            let seen = self.keys.read(key_id(modulus));
            seen != 0 && seen + MAX_AGE > get_block_timestamp()
        }

        fn renew_key(ref self: ContractState, modulus: Span<u256>) {
            self.accesscontrol.assert_only_role(ADMIN_ROLE);
            self.keys.write(key_id(modulus), get_block_timestamp());
        }

        fn remove_key(ref self: ContractState, modulus: Span<u256>) {
            self.accesscontrol.assert_only_role(ADMIN_ROLE);
            self.keys.write(key_id(modulus), 0);
        }
    }

    fn key_id(modulus: Span<u256>) -> felt252 {
        let mut felts = array![];
        modulus.serialize(ref felts);
        poseidon_hash_span(felts.span())
    }
}
