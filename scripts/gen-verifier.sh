#!/usr/bin/env bash
# Generates the verifier and its proof fixture from the circuit: `make verifier`.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root/circuits"

# vk, and a proof that the fake Google JWT in circuits/Prover.toml (make fixtures) passes the login circuit
nargo execute witness
bb write_vk -s ultra_honk --oracle_hash keccak -b target/login.json -o target/
bb prove -s ultra_honk --oracle_hash keccak -b target/login.json -w target/witness.gz -o target/

# verifier for the vk, generated aside: only its code is copied
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
(cd "$tmp" && garaga gen --system ultra_keccak_zk_honk --vk "$root/circuits/target/vk" --project-name verifier)
cd "$root/contracts/verifier"
rm -f src/*.cairo
cp "$tmp"/verifier/src/*.cairo src/
cp "$tmp/verifier/tests/test_contract.cairo" tests/

garaga calldata --system ultra_keccak_zk_honk --vk "$root/circuits/target/vk" --proof "$root/circuits/target/proof" \
    --public-inputs "$root/circuits/target/public_inputs" --format snforge --output-path tests
