# Changelog

## [0.2.2](https://github.com/wyattjoh/op-remote/compare/op-remote-v0.2.1...op-remote-v0.2.2) (2026-04-03)


### Bug Fixes

* add repository URL to package.json for npm provenance ([26c0d55](https://github.com/wyattjoh/op-remote/commit/26c0d55f6e7c954480a71bb2cea3d1d8903f68e8))

## [0.2.1](https://github.com/wyattjoh/op-remote/compare/op-remote-v0.2.0...op-remote-v0.2.1) (2026-04-03)


### Bug Fixes

* harden secret masking, Telegram approval, socket, and token handling ([3676461](https://github.com/wyattjoh/op-remote/commit/36764611620ff038627e7dac44bd8b05de4dce2a))

## [0.2.0](https://github.com/wyattjoh/remote-op/compare/op-remote-v0.1.0...op-remote-v0.2.0) (2026-04-03)


### Features

* add Claude Code plugin manifest and op-remote skill ([f324838](https://github.com/wyattjoh/remote-op/commit/f3248383a027adace2d4c32c3c1d30fca728f58a))
* add CLI run command with env merging and secret masking ([9fd2e1b](https://github.com/wyattjoh/remote-op/commit/9fd2e1b40fc35589092093294bc018a13e73d514))
* add env file parser with op:// reference detection ([192e17a](https://github.com/wyattjoh/remote-op/commit/192e17a90700f69bd5c5d714a7d7e4aa08738d21))
* add MCP server with token, resume, and auto-approve tools ([ffd7eb1](https://github.com/wyattjoh/remote-op/commit/ffd7eb19d6cded56144557db1b0e990f6a3fcf5a))
* add secret masking for subprocess output ([d3d4fc7](https://github.com/wyattjoh/remote-op/commit/d3d4fc7006ab17085e520916bd351cabb4f1140c))
* add shared protocol types for socket communication ([356d5ae](https://github.com/wyattjoh/remote-op/commit/356d5ae4383f5739df1a35bfc73e337f04c935d1))
* add single-use token store with TTL expiry ([716134e](https://github.com/wyattjoh/remote-op/commit/716134ecdd15160bc2cf198ea5d56c485fe08632))
* add Telegram approval client with inline keyboards ([8d212f7](https://github.com/wyattjoh/remote-op/commit/8d212f756b3aaae8cd2d700634dee4c51177a4d4))
* add Unix socket client with integration tests ([35a358a](https://github.com/wyattjoh/remote-op/commit/35a358aeb5f3985538cfb779d4fec1fde9d11db5))
* add Unix socket server with token validation ([fd628c9](https://github.com/wyattjoh/remote-op/commit/fd628c96654eb54edad541469f7699fdd244e9b2))
* scaffold op-remote project with Bun ([680da87](https://github.com/wyattjoh/remote-op/commit/680da8703b3de4053926129a3f7fdc01906834b1))
* wire serve and run subcommands in CLI entrypoint ([499e7bc](https://github.com/wyattjoh/remote-op/commit/499e7bcb4b11e866363e74b69d27f96d07e87fbd))
