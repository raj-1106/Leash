import hashlib
import json
import os
import sys

def get_sha256(path):
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(script_dir)
    prod_wasm = os.path.join(root, "target/near/agent_account/agent_account.wasm")
    test_wasm = os.path.join(root, "target/near/agent_account/agent_account_testing.wasm")
    nft_wasm = os.path.join(root, "target/near/nft/nft.wasm")

    prod_hash = get_sha256(prod_wasm)
    test_hash = get_sha256(test_wasm)
    nft_hash = get_sha256(nft_wasm)

    dev_release = {
        "schema_version": "1.0.0",
        "environment": "development",
        "artifacts": {
            "agent_account": {
                "path": "target/near/agent_account/agent_account.wasm",
                "sha256": prod_hash,
                "size_bytes": os.path.getsize(prod_wasm) if os.path.exists(prod_wasm) else 0,
            },
            "nft": {
                "path": "target/near/nft/nft.wasm",
                "sha256": nft_hash,
                "size_bytes": os.path.getsize(nft_wasm) if os.path.exists(nft_wasm) else 0,
            }
        },
        "forbiddenCodeHashes": [test_hash] if test_hash else []
    }

    out_path = os.path.join(root, "release.dev.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(dev_release, f, indent=2)
    print(f"Generated {out_path}")

if __name__ == "__main__":
    main()
