# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Support multiple Keystone wallets: each keyring instance now owns an
  interaction provider and exposes a stable wallet id, display name and alias.

### Changed

- `KeystoneKeyring` extends `BaseKeyring` instead of the singleton
  `MetaMaskKeyring`, and keeps the Keystone-specific signer address in
  transaction requests.

### Removed

- Removed the `@keystonehq/metamask-airgapped-keyring` dependency in favor of
  the local per-instance interaction provider.

