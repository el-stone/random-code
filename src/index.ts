import { createHash, createHmac, randomBytes } from "node:crypto"
import { hostname, networkInterfaces, platform, arch, uptime } from "node:os"
import { readFileSync } from "node:fs"
import { threadId } from "node:worker_threads"

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789"
const BASE = 35n

const MIN_LENGTH = 32

/*
 * 1 January 2026.
 *
 * This way we don't store milliseconds since 1970.
 */
const EPOCH = Date.UTC(2026, 0, 1)

/*
 * Internal structure:
 *
 * MACHINE       = 50 bits
 * SESSION       = 50 bits
 * TIME          = 42 bits
 * SEQUENCE      = 20 bits
 *
 * Total         = 162 bits
 *
 * 32 base-35 characters ≈ 164 bits.
 */

const MACHINE_BITS = 50n
const SESSION_BITS = 50n

const TIMESTAMP_BITS = 42n
const SEQUENCE_BITS = 20n

const HALF_PAYLOAD_BITS = 31n

const MAX_TIMESTAMP = (1n << TIMESTAMP_BITS) - 1n

const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n

const MASK_31 = (1n << HALF_PAYLOAD_BITS) - 1n

/*
 * These constants are only used to visually scramble
 * the different final parts.
 *
 * MULTIPLIER must be coprime with 35.
 */
const MIX_MULTIPLIER = 0xa0761d6478bd642fn

const MIX_OFFSET = 0xe7037ed1a0b428dbn

/*
 * Generator state.
 */
let lastTimestamp = -1n
let sequence = 0n

/*
 * Cache for 35^n.
 */
const powers: bigint[] = [1n]

function pow35(power: number): bigint {
  while (powers.length <= power) {
    powers.push(powers[powers.length - 1] * BASE)
  }

  return powers[power]
}

/*
 * Converts a Buffer to a bigint.
 */
function bufferToBigInt(buffer: Buffer): bigint {
  const hex = buffer.toString("hex")

  if (!hex) {
    return 0n
  }

  return BigInt(`0x${hex}`)
}

/*
 * Takes the first N bits of a hash.
 */
function takeBits(buffer: Buffer, bits: number): bigint {
  const totalBits = buffer.length * 8

  const value = bufferToBigInt(buffer)

  return value >> BigInt(totalBits - bits)
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8").trim()
  } catch {
    return ""
  }
}

/*
 * Retrieves the available MAC addresses.
 */
function getMacAddresses(): string[] {
  const interfaces = networkInterfaces()

  const result: string[] = []

  for (const entries of Object.values(interfaces)) {
    if (!entries) {
      continue
    }

    for (const entry of entries) {
      const mac = entry.mac?.toLowerCase()

      if (!mac || entry.internal || mac === "00:00:00:00:00:00") {
        continue
      }

      result.push(mac)
    }
  }

  return [...new Set(result)].sort()
}

/*
 * Builds an identity for the machine that is
 * as stable as possible.
 */
function getMachineSource(): string {
  const machineId =
    safeRead("/etc/machine-id") || safeRead("/var/lib/dbus/machine-id")

  const macs = getMacAddresses()

  return [machineId, hostname(), platform(), arch(), ...macs].join("|")
}

/*
 * 50-bit machine fingerprint.
 */
const MACHINE_SOURCE = getMachineSource()

const MACHINE_ID = takeBits(
  createHash("sha256").update(MACHINE_SOURCE).digest(),
  Number(MACHINE_BITS),
)

/*
 * Boot ID.
 *
 * On Linux, boot_id changes at every boot.
 */
function getBootId(): string {
  const linuxBootId = safeRead("/proc/sys/kernel/random/boot_id")

  if (linuxBootId) {
    return linuxBootId
  }

  /*
   * Approximate fallback for other operating systems.
   */
  const bootTimestamp = Math.floor(Date.now() / 1000 - uptime())

  return String(bootTimestamp)
}

/*
 * Each new session gets a cryptographic seed.
 *
 * Two processes on the same machine will therefore
 * have different identities.
 */
const SESSION_SEED = randomBytes(32)

const SESSION_ID = takeBits(
  createHash("sha256")
    .update(MACHINE_SOURCE)
    .update("|")
    .update(getBootId())
    .update("|")
    .update(String(process.pid))
    .update("|")
    .update(String(threadId))
    .update("|")
    .update(SESSION_SEED)
    .digest(),
  Number(SESSION_BITS),
)

/*
 * Private key of this session.
 *
 * It is only used to mask TIME + SEQUENCE.
 *
 * It is NOT contained in the ID.
 */
const SESSION_KEY = createHash("sha256")
  .update("unique-id-session-key:")
  .update(SESSION_SEED)
  .digest()

/*
 * Converts a bigint to 4 bytes.
 *
 * Here the value never exceeds 31 bits.
 */
function uint32Buffer(value: bigint): Buffer {
  const buffer = Buffer.allocUnsafe(4)

  buffer.writeUInt32BE(Number(value & 0xffffffffn), 0)

  return buffer
}

/*
 * Pseudo-random function used by the Feistel network.
 */
function feistelRound(value: bigint, round: number): bigint {
  const roundBuffer = Buffer.from([round])

  const digest = createHmac("sha256", SESSION_KEY)
    .update(roundBuffer)
    .update(uint32Buffer(value))
    .digest()

  return BigInt(digest.readUInt32BE(0)) & MASK_31
}

/*
 * Feistel permutation over exactly 62 bits.
 *
 * Input:
 *
 * 42 bits timestamp
 * 20 bits sequence
 *
 * The output has exactly the same numeric space.
 *
 * Unlike a truncated hash,
 * a permutation does not create collisions
 * within a single session.
 */
function encryptPayload(value: bigint): bigint {
  let left = (value >> HALF_PAYLOAD_BITS) & MASK_31

  let right = value & MASK_31

  /*
   * 8 rounds.
   */
  for (let round = 0; round < 8; round++) {
    const f = feistelRound(right, round)

    const nextLeft = right

    const nextRight = (left ^ f) & MASK_31

    left = nextLeft
    right = nextRight
  }

  return (left << HALF_PAYLOAD_BITS) | right
}

/*
 * Logical timestamp + sequence.
 */
function createPayload(): bigint {
  let timestamp = BigInt(Date.now() - EPOCH)

  if (timestamp < 0n) {
    throw new Error("System clock is before the generator epoch.")
  }

  if (timestamp > MAX_TIMESTAMP) {
    throw new Error("Timestamp capacity exceeded.")
  }

  /*
   * New millisecond.
   */
  if (timestamp > lastTimestamp) {
    lastTimestamp = timestamp
    sequence = 0n
  } else {
    /*
     * Same millisecond or clock moved backwards.
     */
    sequence++

    /*
     * More than 1,048,576 IDs within the same
     * logical millisecond.
     */
    if (sequence > MAX_SEQUENCE) {
      lastTimestamp++
      sequence = 0n
    }

    timestamp = lastTimestamp
  }

  if (lastTimestamp > MAX_TIMESTAMP) {
    throw new Error("Timestamp capacity exceeded.")
  }

  /*
   * [42 bits timestamp][20 bits sequence]
   */
  return (lastTimestamp << SEQUENCE_BITS) | sequence
}

/*
 * Generates a random value directly in base 35.
 *
 * Rejection sampling to avoid modulo bias.
 *
 * 245 = 35 × 7
 */
function randomBase35Value(length: number): bigint {
  let result = 0n

  let generated = 0

  while (generated < length) {
    const remaining = length - generated

    const bytes = randomBytes(Math.max(remaining + 8, 16))

    for (const byte of bytes) {
      if (byte >= 245) {
        continue
      }

      result = result * BASE + BigInt(byte % 35)

      generated++

      if (generated === length) {
        break
      }
    }
  }

  return result
}

/*
 * Bijective mixing within the base-35 space.
 *
 * This also prevents directly seeing:
 *
 * MACHINE
 * SESSION
 * PAYLOAD
 * RANDOM
 *
 * in order.
 */
function mix(value: bigint, length: number): bigint {
  const modulus = pow35(length)

  return (value * MIX_MULTIPLIER + MIX_OFFSET) % modulus
}

/*
 * Encodes using:
 *
 * ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789
 */
function encodeBase35(value: bigint, length: number): string {
  let result = ""

  while (value > 0n) {
    const index = Number(value % BASE)

    result = ALPHABET[index] + result

    value /= BASE
  }

  return result.padStart(length, ALPHABET[0])
}

/*
 * PUBLIC API
 */
export function generateId(length = MIN_LENGTH): string {
  if (!Number.isSafeInteger(length)) {
    throw new TypeError("length must be a safe integer")
  }

  if (length < MIN_LENGTH) {
    throw new RangeError(
      `length must be greater than or equal to ${MIN_LENGTH}`,
    )
  }

  /*
   * TIME + SEQUENCE
   *
   * 62 bits.
   */
  const payload = createPayload()

  /*
   * TIME becomes unreadable without SESSION_KEY.
   */
  const encryptedPayload = encryptPayload(payload)

  /*
   * Structure:
   *
   * [ MACHINE 50 ]
   * [ SESSION 50 ]
   * [ PAYLOAD 62 ]
   *
   * = 162 bits
   */
  let core = MACHINE_ID

  core = (core << SESSION_BITS) | SESSION_ID

  core = (core << 62n) | encryptedPayload

  /*
   * If length > 32:
   *
   * we automatically append cryptographically
   * random characters.
   */
  const extraLength = length - MIN_LENGTH

  if (extraLength > 0) {
    const random = randomBase35Value(extraLength)

    core = core * pow35(extraLength) + random
  }

  /*
   * Mix the whole value so that the random characters
   * are visibly neither at the start,
   * nor in the middle, nor at the end.
   */
  const mixed = mix(core, length)

  return encodeBase35(mixed, length)
}
