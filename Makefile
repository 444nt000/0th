.PHONY: setup versions devnet fixtures verifier test fmt fmt-check
.DEFAULT_GOAL := test

setup:
	scripts/toolchain.sh install
	pnpm install --frozen-lockfile
	git config core.hooksPath .githooks
	scripts/toolchain.sh check

versions:
	scripts/toolchain.sh check

devnet:
	starknet-devnet --seed 0

fixtures:
	cd circuits && node scripts/fixture.ts && nargo fmt

verifier:
	scripts/gen-verifier.sh
	cd contracts && snforge test --package verifier

test:
	cd contracts && scarb test --package account,registry
	cd circuits && nargo test

fmt:
	cd contracts && scarb fmt
	cd circuits && nargo fmt
	pnpm exec prettier --write circuits/scripts web/src

fmt-check:
	cd contracts && scarb fmt --check
	cd circuits && nargo fmt --check
	pnpm exec prettier --check circuits/scripts web/src
