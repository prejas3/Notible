# Third-party notices

The Notible Windows installer ships the following third-party software next to
Notible itself (MIT, see [LICENSE](LICENSE)).

## Node.js runtime

`mcp-server/runtime/node.exe`: Node.js v24.21.0 (win-x64), downloaded unchanged from
nodejs.org by `scripts/fetch-node-runtime.mjs`.

Node.js is licensed under the MIT License, Copyright Node.js contributors and
Joyent, Inc. The binary also contains third-party components (V8, libuv, OpenSSL,
ICU, llhttp, zlib and others) under their own permissive licences. The full text
is at https://github.com/nodejs/node/blob/v24.21.0/LICENSE.

## MCP server dependencies

`mcp-server/node_modules` (production install of `@modelcontextprotocol/sdk`,
`better-sqlite3` and `zod`, with their dependencies). Each package keeps its own
licence file in the installed copy. Licences as declared in each package.json:

| Package | Version | Licence |
|---|---|---|
| @modelcontextprotocol/sdk | 1.18.2 | MIT |
| accepts | 2.0.0 | MIT |
| ajv | 6.15.0 | MIT |
| base64-js | 1.5.1 | MIT |
| better-sqlite3 | 12.2.0 | MIT |
| bindings | 1.5.0 | MIT |
| bl | 4.1.0 | MIT |
| body-parser | 2.3.0 | MIT |
| buffer | 5.7.1 | MIT |
| bytes | 3.1.2 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| call-bound | 1.0.4 | MIT |
| chownr | 1.1.4 | ISC |
| content-disposition | 1.1.0 | MIT |
| content-type | 2.0.0 | MIT |
| content-type | 1.0.5 | MIT |
| cookie | 0.7.2 | MIT |
| cookie-signature | 1.2.2 | MIT |
| cors | 2.8.6 | MIT |
| cross-spawn | 7.0.6 | MIT |
| debug | 4.4.3 | MIT |
| decompress-response | 6.0.0 | MIT |
| deep-extend | 0.6.0 | MIT |
| depd | 2.0.0 | MIT |
| detect-libc | 2.1.2 | Apache-2.0 |
| dunder-proto | 1.0.1 | MIT |
| ee-first | 1.1.1 | MIT |
| encodeurl | 2.0.0 | MIT |
| end-of-stream | 1.4.5 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-object-atoms | 1.1.2 | MIT |
| escape-html | 1.0.3 | MIT |
| etag | 1.8.1 | MIT |
| eventsource | 3.0.7 | MIT |
| eventsource-parser | 3.1.0 | MIT |
| expand-template | 2.0.3 | (MIT OR WTFPL) |
| express | 5.2.1 | MIT |
| express-rate-limit | 7.5.1 | MIT |
| fast-deep-equal | 3.1.3 | MIT |
| fast-json-stable-stringify | 2.1.0 | MIT |
| file-uri-to-path | 1.0.0 | MIT |
| finalhandler | 2.1.1 | MIT |
| forwarded | 0.2.0 | MIT |
| fresh | 2.0.0 | MIT |
| fs-constants | 1.0.0 | MIT |
| function-bind | 1.1.2 | MIT |
| get-intrinsic | 1.3.0 | MIT |
| get-proto | 1.0.1 | MIT |
| github-from-package | 0.0.0 | MIT |
| gopd | 1.2.0 | MIT |
| has-symbols | 1.1.0 | MIT |
| hasown | 2.0.4 | MIT |
| http-errors | 2.0.1 | MIT |
| iconv-lite | 0.7.3 | MIT |
| ieee754 | 1.2.1 | BSD-3-Clause |
| inherits | 2.0.4 | ISC |
| ini | 1.3.8 | ISC |
| ipaddr.js | 1.9.1 | MIT |
| is-promise | 4.0.0 | MIT |
| isexe | 2.0.0 | ISC |
| json-schema-traverse | 0.4.1 | MIT |
| math-intrinsics | 1.1.0 | MIT |
| media-typer | 1.1.0 | MIT |
| merge-descriptors | 2.0.0 | MIT |
| mime-db | 1.54.0 | MIT |
| mime-types | 3.0.2 | MIT |
| mimic-response | 3.1.0 | MIT |
| minimist | 1.2.8 | MIT |
| mkdirp-classic | 0.5.3 | MIT |
| ms | 2.1.3 | MIT |
| napi-build-utils | 2.0.0 | MIT |
| negotiator | 1.0.0 | MIT |
| node-abi | 3.94.0 | MIT |
| object-assign | 4.1.1 | MIT |
| object-inspect | 1.13.4 | MIT |
| on-finished | 2.4.1 | MIT |
| once | 1.4.0 | ISC |
| parseurl | 1.3.3 | MIT |
| path-key | 3.1.1 | MIT |
| path-to-regexp | 8.4.2 | MIT |
| pkce-challenge | 5.0.1 | MIT |
| prebuild-install | 7.1.3 | MIT |
| proxy-addr | 2.0.7 | MIT |
| pump | 3.0.4 | MIT |
| punycode | 2.3.1 | MIT |
| qs | 6.15.3 | BSD-3-Clause |
| range-parser | 1.3.0 | MIT |
| raw-body | 3.0.2 | MIT |
| rc | 1.2.8 | (BSD-2-Clause OR MIT OR Apache-2.0) |
| readable-stream | 3.6.2 | MIT |
| router | 2.2.0 | MIT |
| safe-buffer | 5.2.1 | MIT |
| safer-buffer | 2.1.2 | MIT |
| semver | 7.8.5 | ISC |
| send | 1.2.1 | MIT |
| serve-static | 2.2.1 | MIT |
| setprototypeof | 1.2.0 | ISC |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| side-channel | 1.1.1 | MIT |
| side-channel-list | 1.0.1 | MIT |
| side-channel-map | 1.0.1 | MIT |
| side-channel-weakmap | 1.0.2 | MIT |
| simple-concat | 1.0.1 | MIT |
| simple-get | 4.0.1 | MIT |
| statuses | 2.0.2 | MIT |
| string_decoder | 1.3.0 | MIT |
| strip-json-comments | 2.0.1 | MIT |
| tar-fs | 2.1.5 | MIT |
| tar-stream | 2.2.0 | MIT |
| toidentifier | 1.0.1 | MIT |
| tunnel-agent | 0.6.0 | Apache-2.0 |
| type-is | 2.1.0 | MIT |
| unpipe | 1.0.0 | MIT |
| uri-js | 4.4.1 | BSD-2-Clause |
| util-deprecate | 1.0.2 | MIT |
| vary | 1.1.2 | MIT |
| which | 2.0.2 | ISC |
| wrappy | 1.0.2 | ISC |
| zod | 3.25.76 | MIT |
| zod-to-json-schema | 3.25.2 | ISC |

Where a package offers a choice of licences (`MIT OR WTFPL`, `BSD-2-Clause OR MIT OR Apache-2.0`), Notible uses it under MIT.

Regenerate this table when `mcp-server/package-lock.json` changes.
