.PHONY: all build build-tools web web-serve web-test test check clean build-release demo demo-sync ui-dev ui-build ui-test demo-live repro

all: build test

build:
	cargo near build non-reproducible-wasm --manifest-path contracts/agent-account/Cargo.toml --no-abi --features testing
	cp target/near/agent_account/agent_account.wasm target/near/agent_account/agent_account_testing.wasm
	cargo near build non-reproducible-wasm --manifest-path contracts/agent-account/Cargo.toml --no-abi
	cargo near build non-reproducible-wasm --manifest-path contracts/nft/Cargo.toml --no-abi
	cargo near build non-reproducible-wasm --manifest-path contracts/toy-identity/Cargo.toml --no-abi
	python3 scripts/gen_dev_release.py
	$(MAKE) build-tools
	$(MAKE) web

build-tools:
	cd tools && npm ci && npm run build

web:
	cd tools && ./node_modules/.bin/tsc -p tsconfig.esm.json
	cp release.json web/release.json
	cp demo-run.sample.json web/demo-run.sample.json

web-serve: web
	@echo "Serving Leash Inspection Report at http://localhost:8080..."
	cd web && python3 -m http.server 8080

web-test: web
	cd tools && npm test

build-release:
	cargo near build non-reproducible-wasm --manifest-path contracts/agent-account/Cargo.toml --no-abi
	cargo near build non-reproducible-wasm --manifest-path contracts/nft/Cargo.toml --no-abi

test: build
	cargo test -p agent-account --lib
	cargo test -p integration-tests -- --test-threads=2
	cd tools && npm test

check:
	cargo check --target wasm32-unknown-unknown -p agent-account -p nft
	cargo check -p integration-tests

demo:
	cargo test -p integration-tests --test contract_tests test_offline_demo_runner_and_export_json -- --nocapture

demo-sync: demo
	cp demo-run.json web/demo-run.json

ui-dev: web-serve

ui-build: web
	@echo "Static asset bundle ready in web/"

ui-test:
	grep -nE "innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function" web/* || true


demo-live: web
	@echo "Starting persistent sandbox and Leash Inspector..."
	cd tools && node --input-type=module < ../scripts/demo_live.mjs

demo-testnet:
	cd tools && node --input-type=module < ../scripts/live_spend_demo.mjs

test-chain-proof:
	cd tools && node --input-type=module < ../scripts/chain_proof.mjs

test-live-deploy:
	cd tools && node --input-type=module < ../scripts/test_live_deploy_sandbox.mjs

# Local reproducible build in Docker from working tree HEAD
repro:
	cargo near build reproducible-wasm --manifest-path contracts/agent-account/Cargo.toml
	cargo near build reproducible-wasm --manifest-path contracts/nft/Cargo.toml
	sha256sum target/near/agent_account/agent_account.wasm target/near/nft/nft.wasm

# 2x Clean-clone reproducible build verification across independent clones (used for release verification at git tag)
# Usage: make repro-clean [REF=v0.1.0]
repro-clean:
	./scripts/run_clean_repro_2x.sh $(REF)
