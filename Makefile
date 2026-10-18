.PHONY: fixtures start-devnet stop-devnet restart-devnet down-devnet \
		logs-devnet check-devnet server sync-keys import-devnet-account \
		verifier-image gen-verifier deploy-devnet deploy-sepolia deploy-mainnet \
		clean fclean fmt fmt-check

# DEVNET

DEVNET_COMPOSE = docker compose -f compose.dev.yaml -p 0th-dev

DEVNET_SEED = devnet-seed-not-a-secret
GOOGLE_CLIENT_ID = 16619420523-e9c66plhahqsbj7u4090p1d66iapd4p4.apps.googleusercontent.com

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

server:
	RPC_URL=http://127.0.0.1:5050/rpc \
	SEED=$(DEVNET_SEED) \
	GOOGLE_CLIENT_ID=$(GOOGLE_CLIENT_ID) \
	ACCOUNT=$$(jq -r .admin deployments/devnet.json) \
	ACCOUNT_CLASS_HASH=$$(jq -r .accountClassHash deployments/devnet.json) \
	PRIVATE_KEY=$$(curl -sS -X POST localhost:5050/rpc -H 'content-type: application/json' \
		-d '{"jsonrpc":"2.0","id":1,"method":"devnet_getPredeployedAccounts","params":{}}' \
		| jq -r '.result[0].private_key') \
	DEVNET=1 \
	pnpm --filter server start

sync-keys:
	RPC_URL=http://127.0.0.1:5050/rpc \
	REGISTRY=$$(jq -r .registry deployments/devnet.json) \
	ACCOUNT=$$(jq -r .admin deployments/devnet.json) \
	PRIVATE_KEY=$$(curl -sS -X POST localhost:5050/rpc -H 'content-type: application/json' \
		-d '{"jsonrpc":"2.0","id":1,"method":"devnet_getPredeployedAccounts","params":{}}' \
		| jq -r '.result[0].private_key') \
	pnpm --filter registry run sync

import-devnet-account:
	mkdir -p contracts/.sncast
	-cd contracts && sncast --profile devnet account delete --name devnet-1 --url http://localhost:5050 --yes
	cd contracts && curl -sS -X POST localhost:5050/rpc -H 'content-type: application/json' \
		-d '{"jsonrpc":"2.0","id":1,"method":"devnet_getPredeployedAccounts","params":{}}' \
		| jq -r '.result[0] | "--address", .address, "--private-key", .private_key' \
		| xargs sncast --profile devnet account import --name devnet-1 --type oz --silent

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

# deploy single contract with contract=<verifier|registry|account>
deploy-devnet deploy-sepolia deploy-mainnet: deploy-%:
	cd contracts && scarb build
	pnpm --filter scripts run deploy $* $(contract)


# CLEAN

clean: down-devnet
	rm -rf contracts/.sncast deployments
	rm -rf circuits/target contracts/target

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
