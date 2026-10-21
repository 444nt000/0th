.PHONY: fixtures start-devnet stop-devnet restart-devnet down-devnet \
		logs-devnet check-devnet server registry web \
		verifier-image gen-verifier deploy clean fclean fmt fmt-check

NETWORK ?= devnet

# DEVNET

DEVNET_COMPOSE = docker compose -f compose.dev.yaml -p 0th-dev

start-devnet:
	$(DEVNET_COMPOSE) up -d

stop-devnet:
	$(DEVNET_COMPOSE) stop

restart-devnet:
	$(DEVNET_COMPOSE) restart

down-devnet:
	$(DEVNET_COMPOSE) down

logs-devnet:
	$(DEVNET_COMPOSE) logs -f

check-devnet:
	curl -sS localhost:5050/is_alive

# SERVICES

-include deployments/$(NETWORK).env
-include .env.$(NETWORK)
export

VITE_RPC_URL ?= $(RPC_URL)
VITE_GOOGLE_CLIENT_ID ?= $(GOOGLE_CLIENT_ID)
VITE_ADMIN ?= $(ADMIN)
VITE_REGISTRY ?= $(REGISTRY)
VITE_VERIFIER ?= $(VERIFIER)
VITE_ACCOUNT_CLASS_HASH ?= $(ACCOUNT_CLASS_HASH)

server:
	pnpm --filter server start

registry:
	pnpm --filter registry run sync

web:
	pnpm --filter web dev

# CIRCUIT

fixtures:
	pnpm --filter circuits exec node scripts/fixture.ts

# VERIFIER

SYSTEM = ultra_keccak_zk_honk
VERIFIER_IMAGE = 0th-verifier-tools
VERIFIER_NARGO_CACHE = 0th-verifier-nargo-cache

verifier-image:
	docker build -t $(VERIFIER_IMAGE) circuits

gen-verifier: verifier-image
	docker volume create $(VERIFIER_NARGO_CACHE) > /dev/null
	docker run --rm -v $(VERIFIER_NARGO_CACHE):/root/nargo $(VERIFIER_IMAGE) chmod a+rwX /root/nargo
	docker run --rm --user "$$(id -u):$$(id -g)" \
		-v "$$(pwd)":/work -v $(VERIFIER_NARGO_CACHE):/root/nargo \
		$(VERIFIER_IMAGE) bash -c '\
		cd circuits && \
		nargo execute witness && \
		mkdir -p target/.bb-crs && \
		bb write_vk -s ultra_honk --oracle_hash keccak -b target/login.json -o target/ -c target/.bb-crs && \
		bb prove -s ultra_honk --oracle_hash keccak -b target/login.json -w target/witness.gz -o target/ -c target/.bb-crs && \
		rm -rf /tmp/verifier && \
		(cd /tmp && garaga gen --system $(SYSTEM) --vk /work/circuits/target/vk --project-name verifier) && \
		rm -f ../contracts/verifier/src/*.cairo && \
		cp /tmp/verifier/src/*.cairo ../contracts/verifier/src/ && \
		cp /tmp/verifier/tests/test_contract.cairo ../contracts/verifier/tests/ && \
		garaga calldata --system $(SYSTEM) --vk target/vk --proof target/proof \
			--public-inputs target/public_inputs --format snforge --output-path ../contracts/verifier/tests && \
		cd ../contracts/verifier && scarb fmt \
	'

# CONTRACTS

# make deploy NETWORK=<devnet|sepolia|mainnet>, one contract alone with contract=<verifier|registry|account>
deploy:
	cd contracts && scarb build
	pnpm --filter scripts run deploy $(NETWORK) $(contract)


# CLEAN

clean: down-devnet
	rm -rf circuits/target contracts/target web/dist
	rm -f deployments/devnet.env

fclean: clean
	docker rmi $(VERIFIER_IMAGE) 2>/dev/null || true
	docker volume rm $(VERIFIER_NARGO_CACHE) 2>/dev/null || true

# FORMAT

PRETTIER = circuits/scripts sdk/src web/src server/src registry/src scripts

fmt:
	cd contracts && scarb fmt
	cd circuits && nargo fmt
	pnpm exec prettier --write $(PRETTIER)

fmt-check:
	cd contracts && scarb fmt --check
	cd circuits && nargo fmt --check
	pnpm exec prettier --check $(PRETTIER)
