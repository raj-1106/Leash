# Multi-stage build: use official pre-cached Rust 1.99.1 toolchain with Ubuntu 24.04 (GLIBC 2.39 runtime)
FROM rust:1.99.1-bookworm AS rust-toolchain

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

# Copy pre-installed Rust 1.99.1 toolchain
COPY --from=rust-toolchain /usr/local/cargo /usr/local/cargo
COPY --from=rust-toolchain /usr/local/rustup /usr/local/rustup

# Install Node.js 20.x, Python 3, build essentials, and git
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    build-essential \
    pkg-config \
    libssl-dev \
    git \
    python3 \
    python3-pip \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install wasm32 target and official cargo-near prebuilt binary
RUN rustup target add wasm32-unknown-unknown && \
    curl -fsSL https://github.com/near/cargo-near/releases/download/cargo-near-v0.22.0/cargo-near-x86_64-unknown-linux-gnu.tar.gz | \
    tar -xz --strip-components=1 -C /usr/local/cargo/bin cargo-near-x86_64-unknown-linux-gnu/cargo-near

WORKDIR /workspace

# Copy workspace sources
COPY Cargo.toml Cargo.lock rust-toolchain.toml Makefile ./
COPY contracts contracts
COPY tests tests
COPY tools tools
COPY scripts scripts
COPY docs docs
COPY release.json demo-run.sample.json ./
COPY web web

# 1. Prefetch all cargo crates
RUN cargo fetch

# 2. Build WASMs, dev release artifact, tools/dist, and web ESM evaluator
RUN make build

# 3. Pre-compile test binaries and fetch/pin near-sandbox binary during build
RUN cargo test -p integration-tests --no-run

# 4. Pin sandbox binary to /usr/local/bin/near-sandbox so tests run 100% offline
RUN SANDBOX_BIN=$(find target/debug/build/ -name "near-sandbox" -type f -perm /111 | sort -V | tail -n 1) && \
    if [ -n "$SANDBOX_BIN" ]; then \
        echo "Pinned sandbox binary from $SANDBOX_BIN to /usr/local/bin/near-sandbox"; \
        cp "$SANDBOX_BIN" /usr/local/bin/near-sandbox; \
        chmod +x /usr/local/bin/near-sandbox; \
    fi

ENV NEAR_SANDBOX_BIN_PATH=/usr/local/bin/near-sandbox

# Acceptance test: executes demo runner with zero network access
CMD ["make", "demo"]
