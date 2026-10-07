#[starknet::contract]
pub mod MockVerifier {
    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl MockVerifierImpl of verifier::honk_verifier::IUltraKeccakZKHonkVerifier<ContractState> {
        // Skips the proof check: the calldata is `count, (low, high) * count`, returned as is
        fn verify_ultra_keccak_zk_honk_proof(
            self: @ContractState, full_proof_with_hints: Span<felt252>,
        ) -> Result<Span<u256>, felt252> {
            let count: u32 = (*full_proof_with_hints.at(0)).try_into().unwrap();
            let mut inputs = array![];
            for i in 0..count {
                let low: u128 = (*full_proof_with_hints.at(1 + 2 * i)).try_into().unwrap();
                let high: u128 = (*full_proof_with_hints.at(2 + 2 * i)).try_into().unwrap();
                inputs.append(u256 { low, high });
            }
            Result::Ok(inputs.span())
        }
    }
}
