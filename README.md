# @el-stone/random-code

[![npm version](https://img.shields.io/npm/v/@el-stone/random-code.svg)](https://www.npmjs.com/package/@el-stone/random-code)
[![license](https://img.shields.io/npm/l/@el-stone/random-code.svg)](./LICENCE)
[![node](https://img.shields.io/node/v/@el-stone/random-code.svg)](https://nodejs.org)
[![GitHub](https://img.shields.io/github/stars/el-stone/random-code?style=flat&logo=github)](https://github.com/el-stone/random-code)

Collision-resistant ID generator for Node.js. Each ID combines a machine fingerprint, a per-process session, a time-based counter and (optionally) secure randomness, with a customizable length.

```js
import { generateCode } from "@el-stone/random-code"

generateCode() // "FWLU2YTZHIT6NEEIXFCCBK339TUMA3GM"
generateCode(48) // "FWLU2YTYPCXUGFIUD7ADYDYHARBP4I7ASZB8OJI363725QUU"
```

## Features

- **No coordination needed**: no database, no server, no shared counter. Everything is computed locally.
- **Collision-resistant**: machine + session + timestamp + sequence, so distributed processes do not step on each other.
- **Guaranteed unique within a process**: the time/sequence part goes through a permutation (not a truncated hash), so two IDs from the same session can never collide.
- **Handles bursts**: up to 1,048,576 IDs per millisecond per session, and it keeps working if the system clock moves backwards.
- **Customizable length**: 32 characters minimum, extra characters are filled with cryptographically secure random values.
- **Readable alphabet**: uppercase letters and digits `1-9` only (base 35, no `0` to avoid confusion with `O`).
- **Dual package**: ESM and CommonJS, with TypeScript types included.

## Performance

Measured with `npm run bench` on Node.js 24 (single thread, one run on the author's machine, your numbers will vary):

| Length | IDs per second |
| ------ | -------------- |
| 32     | ~21,000        |
| 64     | ~15,000        |
| 128    | ~9,000         |

Each ID costs 8 HMAC-SHA256 calls, which is what keeps the timestamp unreadable. The trade-off is throughput: this package favors uniqueness and opacity over raw speed.

## Installation

```bash
npm install @el-stone/random-code
```

Using Yarn:

```bash
yarn add @el-stone/random-code
```

Using pnpm:

```bash
pnpm add @el-stone/random-code
```

Requires **Node.js 18 or later**.

## Usage

```ts
import { generateCode } from "@el-stone/random-code"

const id = generateCode() // 32 characters
const longId = generateCode(64) // 64 characters
```

CommonJS:

```js
const { generateCode } = require("@el-stone/random-code")

const id = generateCode()
```

## API

### `generateCode(length?: number): string`

| Parameter | Type     | Default | Description                                    |
| --------- | -------- | ------- | ---------------------------------------------- |
| `length`  | `number` | `32`    | Length of the ID. Must be a safe integer ≥ 32. |

Returns a string of exactly `length` characters, each one in `A-Z1-9`.

**Errors**

| Error        | When                                                                            |
| ------------ | ------------------------------------------------------------------------------- |
| `TypeError`  | `length` is not a safe integer (`32.5`, `NaN`, `Infinity`, ...)                 |
| `RangeError` | `length` is lower than 32                                                       |
| `Error`      | The system clock is before 2026-01-01, or past the generator's capacity (~2165) |

## How it works

An ID is built from 162 bits, encoded in base 35:

| Part        | Bits | Source                                                                                      |
| ----------- | ---- | ------------------------------------------------------------------------------------------- |
| **MACHINE** | 50   | SHA-256 of the machine id, hostname, platform, architecture and MAC addresses               |
| **SESSION** | 50   | SHA-256 of the machine, boot id, process id, thread id and a random 32-byte seed            |
| **PAYLOAD** | 62   | 42-bit timestamp (ms since 2026-01-01) + 20-bit sequence, encrypted with a session-only key |

1. The timestamp and sequence are combined. A new millisecond resets the sequence; within the same millisecond (or if the clock goes backwards) the sequence increments.
2. That 62-bit value goes through an 8-round Feistel permutation keyed with a secret that lives only in memory and is never part of the ID. Because it is a permutation, it cannot create collisions within a session.
3. `MACHINE`, `SESSION` and the encrypted payload are concatenated.
4. If `length > 32`, secure random base-35 digits are appended (rejection sampling, no modulo bias).
5. The whole value is scrambled with a bijective mix and encoded in base 35.

## Good to know

- **Not sortable**: since the timestamp is encrypted, IDs are not ordered by creation time.
- **Not a secret**: do not use these IDs as passwords, API keys or session tokens. The final mixing step is only meant to scramble the structure visually, it is not cryptographic. IDs generated by the same process share a common prefix, and the machine fingerprint contributes to every ID.
- **Uniqueness across processes is probabilistic**: within one process it is guaranteed, across machines and sessions it relies on the 100 bits of machine and session entropy.
- **Node.js only**: it relies on `node:crypto`, `node:os`, `node:fs` and `node:worker_threads`, so it does not run in browsers.
- **Time range**: the 42-bit timestamp covers about 139 years from 2026-01-01, so until roughly 2165.

## Development

```bash
npm install
npm run typecheck   # type-check the project
npm run build       # build ESM + CJS + types into dist/
npm run dev         # rebuild on change
npm test            # run the test suite
npm run bench       # build, then measure IDs generated per second
```

Clone the repository:

```bash
git clone https://github.com/el-stone/random-code.git
```

## Contributing

This is an open-source project, contributions are welcome.

- Source code: [github.com/el-stone/random-code](https://github.com/el-stone/random-code)
- Bug reports and feature requests: [GitHub Issues](https://github.com/el-stone/random-code/issues)
- Pull requests: fork the repository, make your change with tests (`npm test`), then open a pull request.

## Support

If you find this package useful, consider giving the project a ⭐ on GitHub.
For bugs, feature requests, or suggestions, please open an issue on the GitHub repository.

## License

[MIT](./LICENCE) © El Stone
