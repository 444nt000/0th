.PHONY: setup versions devnet deploy-devnet fixtures verifier test fmt fmt-check
.DEFAULT_GOAL := test

PRETTIER = circuits/scripts web/src deploy

setup:
	scripts/toolchain.sh install
	pnpm install --frozen-lockfile
	git config core.hooksPath .githooks
	scripts/toolchain.sh check

versions:
	scripts/toolchain.sh check

devnet:
	starknet-devnet --seed 0

deploy-devnet:
	cd contracts && scarb build
	pnpm --filter deploy devnet

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
	pnpm exec prettier --write $(PRETTIER)

fmt-check:
	cd contracts && scarb fmt --check
	cd circuits && nargo fmt --check
	pnpm exec prettier --check $(PRETTIER)
