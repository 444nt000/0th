// Project
use account::account::{IAccountDispatcherTrait, MAX_SESSION};

// OpenZeppelin
use openzeppelin_access::accesscontrol::DEFAULT_ADMIN_ROLE;
use openzeppelin_interfaces::accesscontrol::{
    IAccessControlDispatcher, IAccessControlDispatcherTrait,
};

// Snforge
use snforge_std::start_cheat_block_timestamp_global;

// Tests
use crate::utils::helpers::{
    ADMIN, EXPIRY, SESSION_KEY_INPUT, STRANGER, load_proof, mock_proof, public_inputs,
    replace_input, session_key,
};
use crate::utils::setup::{fixture_identity, setup};

#[test]
fn test_constructor_grants_admin() {
    let (account, _registry) = setup("MockVerifier", fixture_identity(), true);

    let acl = IAccessControlDispatcher { contract_address: account.contract_address };
    assert!(acl.has_role(DEFAULT_ADMIN_ROLE, ADMIN));
    assert!(!acl.has_role(DEFAULT_ADMIN_ROLE, STRANGER));
}

#[test]
fn test_register_session() {
    let (account, _registry) = setup("MockVerifier", fixture_identity(), true);
    let inputs = public_inputs(load_proof().span());

    account.register_session(mock_proof(inputs.span()).span());

    assert_eq!(account.get_session_expiry(session_key(inputs.span())), EXPIRY);
}

#[test]
#[should_panic(expected: ('wrong identity', 'ENTRYPOINT_FAILED'))]
fn test_register_session_wrong_identity() {
    let (account, _registry) = setup("MockVerifier", fixture_identity() + 1, true);
    let inputs = public_inputs(load_proof().span());

    account.register_session(mock_proof(inputs.span()).span()); // (must panic)
}

#[test]
#[should_panic(expected: ('unknown Google key', 'ENTRYPOINT_FAILED'))]
fn test_register_session_unknown_key() {
    let (account, _registry) = setup("MockVerifier", fixture_identity(), false);
    let inputs = public_inputs(load_proof().span());

    account.register_session(mock_proof(inputs.span()).span()); // (must panic)
}

#[test]
#[should_panic(expected: ('session expired', 'ENTRYPOINT_FAILED'))]
fn test_register_session_expired() {
    let (account, _registry) = setup("MockVerifier", fixture_identity(), true);
    let inputs = public_inputs(load_proof().span());
    start_cheat_block_timestamp_global(EXPIRY);

    account.register_session(mock_proof(inputs.span()).span()); // (must panic)
}

#[test]
fn test_register_session_real_proof() {
    let (account, _registry) = setup("UltraKeccakZKHonkVerifier", fixture_identity(), true);
    let proof = load_proof();
    let inputs = public_inputs(proof.span());

    account.register_session(proof.span());

    assert_eq!(account.get_session_expiry(session_key(inputs.span())), EXPIRY);
}

// Garaga panics in its hint check before it can return 'invalid proof'
#[test]
#[should_panic(
    expected: ('Wrong GLV/FakeGLV decomposition', 'ENTRYPOINT_FAILED', 'ENTRYPOINT_FAILED'),
)]
fn test_register_session_real_proof_tampered_session_key() {
    let (account, _registry) = setup("UltraKeccakZKHonkVerifier", fixture_identity(), true);
    let mut proof = load_proof();
    let inputs = public_inputs(proof.span());
    let tampered = replace_input(inputs.span(), SESSION_KEY_INPUT, 2);
    let mut tampered_proof = mock_proof(tampered.span());
    for i in (1 + 2 * tampered.len())..proof.len() {
        tampered_proof.append(*proof[i]);
    }

    account.register_session(tampered_proof.span()); // (must panic)
}

#[test]
#[should_panic(expected: ('session too long', 'ENTRYPOINT_FAILED'))]
fn test_register_session_too_long() {
    let (account, _registry) = setup("MockVerifier", fixture_identity(), true);
    let inputs = public_inputs(load_proof().span());
    start_cheat_block_timestamp_global(EXPIRY - MAX_SESSION - 1);

    account.register_session(mock_proof(inputs.span()).span()); // (must panic)
}
