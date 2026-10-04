.PHONY: setup versions devnet build test fmt fmt-check clean

BB_VERSION := 3.0.0-nightly.20251104
GARAGA_VERSION := 1.1.0
USC_VERSION := 2.10.1
NOIR_PLUGIN := https://github.com/444nt000/asdf-noir.git

pin = $(shell awk '$$1 == "$(1)" { print $$2 }' .tool-versions)
USC := universal-sierra-compiler-v$(USC_VERSION)-$(shell uname -m)-$(if $(filter Darwin,$(shell uname)),apple-darwin,unknown-linux-gnu)

# install the pinned toolchain. needs asdf, bbup, uv.
setup:
	-asdf plugin add scarb 2> /dev/null
	-asdf plugin add starknet-foundry 2> /dev/null
	-asdf plugin add noir $(NOIR_PLUGIN) 2> /dev/null
	-asdf plugin add starknet-devnet 2> /dev/null
	asdf install
	bbup -v $(BB_VERSION)
	uv tool install --force --python 3.12 garaga==$(GARAGA_VERSION) --with fastecdsa==3.0.1
	curl -fsSL https://github.com/software-mansion/universal-sierra-compiler/releases/download/v$(USC_VERSION)/$(USC).tar.gz \
		| tar -xz -C $(HOME)/.local/bin --strip-components=2 $(USC)/bin/universal-sierra-compiler
	git config core.hooksPath .githooks
	@$(MAKE) --no-print-directory versions

# expect: tool, version command, pinned version. stops at the first wrong tool.
define expect
	@v=$$($(2) 2> /dev/null | head -n1); case "$$v" in \
		*"$(3)"*) echo "ok   $(1) $(3)" ;; \
		*) echo "BAD  $(1): want $(3), got '$$v' ($$(command -v $(1) || echo not found))"; \
		   echo "fix: make setup, and put ~/.bb and ~/.local/bin early in PATH"; exit 1 ;; \
	esac
endef

versions:
	$(call expect,scarb,scarb --version,$(call pin,scarb))
	$(call expect,snforge,snforge --version,$(call pin,starknet-foundry))
	$(call expect,sncast,sncast --version,$(call pin,starknet-foundry))
	$(call expect,nargo,nargo --version,$(call pin,noir))
	$(call expect,starknet-devnet,starknet-devnet --version,$(call pin,starknet-devnet))
	$(call expect,bb,bb --version,$(BB_VERSION))
	$(call expect,universal-sierra-compiler,universal-sierra-compiler --version,$(USC_VERSION))
	$(call expect,garaga,garaga --help > /dev/null 2>&1 && uv tool list | grep '^garaga ',$(GARAGA_VERSION))

devnet:
	starknet-devnet --seed 0

build:
	cd contracts && scarb build
	cd circuits && nargo compile

test:
	cd contracts && scarb test
	cd circuits && nargo test

fmt:
	cd contracts && scarb fmt
	cd circuits && nargo fmt

fmt-check:
	cd contracts && scarb fmt --check
	cd circuits && nargo fmt --check

clean:
	cd contracts && scarb clean
	rm -rf circuits/target contracts/.snfoundry_cache
