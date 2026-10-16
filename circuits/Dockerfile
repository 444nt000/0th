FROM python:3.12-slim

ARG BB_VERSION=3.0.0-nightly.20251104
ARG GARAGA_VERSION=1.1.0
ARG SCARB_VERSION=2.18.0
ARG NOIR_VERSION=1.0.0-beta.16

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

ENV HOME=/root
ENV PATH=/root/.local/bin:${PATH}

RUN curl -Ls https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash \
    && mkdir -p /root/.local/bin \
    && /root/.bb/bbup -v ${BB_VERSION} \
    && cp /root/.bb/bb /root/.local/bin/bb \
    && rm -rf /root/.bb \
    && bb --version

RUN curl --proto '=https' --tlsv1.2 -sSf https://docs.swmansion.com/scarb/install.sh \
    | bash -s -- -v ${SCARB_VERSION} \
    && scarb --version

RUN curl -Ls https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash \
    && /root/.nargo/bin/noirup -v ${NOIR_VERSION} \
    && cp /root/.nargo/bin/nargo /root/.local/bin/nargo \
    && rm -rf /root/.nargo \
    && nargo --version

RUN pip install --no-cache-dir "garaga==${GARAGA_VERSION}" "fastecdsa==3.0.1"

RUN chmod -R a+rX /root

WORKDIR /work
