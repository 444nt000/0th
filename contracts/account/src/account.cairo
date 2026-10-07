#[starknet::interface]
pub trait IAccount<TContractState> {
    fn register_session(ref self: TContractState, proof: Span<felt252>);
    fn get_session_expiry(self: @TContractState, session_key: felt252) -> u64;
}

// Longest session a proof may ask for (30 days)
pub const MAX_SESSION: u64 = 30 * 24 * 3600;

#[starknet::contract]
pub mod Account {
    // OpenZeppelin
    use openzeppelin_access::accesscontrol::{AccessControlComponent, DEFAULT_ADMIN_ROLE};
    use openzeppelin_introspection::src5::SRC5Component;

    // Registry
    use registry::registry::{IKeyRegistryDispatcher, IKeyRegistryDispatcherTrait};

    // Starknet
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp};

    // Verifier
    use verifier::honk_verifier::{
        IUltraKeccakZKHonkVerifierDispatcher, IUltraKeccakZKHonkVerifierDispatcherTrait,
    };
    use super::MAX_SESSION;
    pub const ADMIN_ROLE: felt252 = DEFAULT_ADMIN_ROLE;

    // Position of each public input of the proof (circuits/src/main.nr)
    const MODULUS_LIMBS: usize = 18;
    const SESSION_KEY_INPUT: usize = 18;
    const EXPIRY_INPUT: usize = 19;
    const IDENTITY_INPUT: usize = 20;

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
        registry: ContractAddress,
        verifier: ContractAddress,
        identity_hash: u256, // H(iss, aud, sub, salt), BN254 field element
        sessions: Map<felt252, u64>,
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
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        registry: ContractAddress,
        verifier: ContractAddress,
        identity_hash: u256,
    ) {
        self.accesscontrol.initializer();
        self.accesscontrol._grant_role(ADMIN_ROLE, admin);

        self.registry.write(registry);
        self.verifier.write(verifier);
        self.identity_hash.write(identity_hash);
    }

    #[abi(embed_v0)]
    impl AccountImpl of super::IAccount<ContractState> {
        fn register_session(ref self: ContractState, proof: Span<felt252>) {
            // Verify the proof
            let inputs = IUltraKeccakZKHonkVerifierDispatcher {
                contract_address: self.verifier.read(),
            }
                .verify_ultra_keccak_zk_honk_proof(proof)
                .expect('invalid proof');

            // Read the public inputs
            let modulus = inputs.slice(0, MODULUS_LIMBS);
            // u256 to felt252 fails above the stark prime, a big key is rejected
            let session_key: felt252 = (*inputs[SESSION_KEY_INPUT])
                .try_into()
                .expect('session key too large');
            let expiry: u64 = (*inputs[EXPIRY_INPUT]).try_into().unwrap();
            let identity_hash = *inputs[IDENTITY_INPUT];

            // Check the proof is for this account
            assert(identity_hash == self.identity_hash.read(), 'wrong identity');

            // Check the signing key is Google's (the proof holds for any RSA key)
            assert(
                IKeyRegistryDispatcher { contract_address: self.registry.read() }.is_key(modulus),
                'unknown Google key',
            );

            // Check the expiry
            let now = get_block_timestamp();
            assert(expiry > now, 'session expired');
            assert(expiry <= now + MAX_SESSION, 'session too long');

            // Store the session
            self.sessions.write(session_key, expiry);
        }

        fn get_session_expiry(self: @ContractState, session_key: felt252) -> u64 {
            self.sessions.read(session_key)
        }
    }
}
