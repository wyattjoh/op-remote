# Changelog

## [0.5.3](https://github.com/wyattjoh/op-remote/compare/op-remote-v0.5.2...op-remote-v0.5.3) (2026-04-11)


### Bug Fixes

* remove unused .prettierignore ([fbdd72f](https://github.com/wyattjoh/op-remote/commit/fbdd72fb39e17ce42a7ba6ad3e24b6b623a89272))

## [0.5.2](https://github.com/wyattjoh/op-remote/compare/op-remote-v0.5.1...op-remote-v0.5.2) (2026-04-11)


### Miscellaneous Chores

* release 0.5.2 ([368a82c](https://github.com/wyattjoh/op-remote/commit/368a82c8e0271ef39da69743be04b983384dc1f4))

## [0.5.1](https://github.com/wyattjoh/op-remote/compare/op-remote-v0.5.0...op-remote-v0.5.1) (2026-04-11)


### Bug Fixes

* replace Bun APIs with node equivalents ([5825070](https://github.com/wyattjoh/op-remote/commit/5825070a4d3a4a9963a336e71fbc809922f988af))
* **telegram:** send force-reply prompt as a new message ([bde1474](https://github.com/wyattjoh/op-remote/commit/bde14746c193436afa7155aecdd00be7f780eec0))

## [0.5.0](https://github.com/wyattjoh/op-remote/compare/op-remote-v0.4.1...op-remote-v0.5.0) (2026-04-11)


### Features

* load project secrets at server startup via op run ([3660e14](https://github.com/wyattjoh/op-remote/commit/3660e144451ce838e730a54b3ffb89c4361ce851))


### Bug Fixes

* **security:** harden socket and Telegram approval handling ([c16548d](https://github.com/wyattjoh/op-remote/commit/c16548d8ff5e541344d4f3a9a648582f60a65b37))

## [0.4.1](https://github.com/wyattjoh/op-remote/compare/op-remote-v0.4.0...op-remote-v0.4.1) (2026-04-06)


### Bug Fixes

* add required type and title fields to userConfig entries ([f748fac](https://github.com/wyattjoh/op-remote/commit/f748fac702f6112896c65ce38b30dac9fa6f63d4))

## [0.4.0](https://github.com/wyattjoh/op-remote/compare/op-remote-v0.3.1...op-remote-v0.4.0) (2026-04-06)


### Features

* add userConfig for Telegram credentials in plugin manifest ([d2b523c](https://github.com/wyattjoh/op-remote/commit/d2b523cfe0e2e11924bfb7e82cd2c0d3c9575c35))

## [0.3.1](https://github.com/wyattjoh/op-remote/compare/op-remote-v0.3.0...op-remote-v0.3.1) (2026-04-05)


### Bug Fixes

* use release-please extra-files for plugin.json args version sync ([39b72a2](https://github.com/wyattjoh/op-remote/commit/39b72a2a6c1884be9956291c1348388e71547b55))

## [0.3.0](https://github.com/wyattjoh/op-remote/compare/op-remote-v0.2.2...op-remote-v0.3.0) (2026-04-04)


### Features

* add marketplace update step to release workflow ([693fa55](https://github.com/wyattjoh/op-remote/commit/693fa558f386f8cbd1040fd7ceb9d77292b14a60))
* add MCP server config and auto-sync version in release workflow ([0cf28d2](https://github.com/wyattjoh/op-remote/commit/0cf28d275ccee86ddaef2a1ef3d304a4cd697a5f))

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
