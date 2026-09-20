import { afterEach, describe, expect, it, vi } from "vitest"
import { generateCode } from "../src/index"

// Generating 100,000 IDs takes ~5s, which exceeds Vitest's default 5s timeout.
const HEAVY_TEST_TIMEOUT = 30_000

describe("generateCode", () => {
  // Restore Date.now after the tests that mock it.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --- Length and format ---

  it("should generate an ID with the default length of 32", () => {
    const id = generateCode()

    expect(id).toHaveLength(32)
  })

  it("should generate an ID with a custom length", () => {
    const id = generateCode(40)

    expect(id).toHaveLength(40)
  })

  it("should support large custom lengths", () => {
    const id = generateCode(100)

    expect(id).toHaveLength(100)
  })

  // The alphabet is base 35: A-Z and 1-9 (no 0).
  it("should only contain A-Z and 1-9", () => {
    const id = generateCode(100)

    expect(id).toMatch(/^[A-Z1-9]+$/)
  })

  // --- Uniqueness ---

  it("should generate different IDs on consecutive calls", () => {
    const first = generateCode()
    const second = generateCode()

    expect(first).not.toBe(second)
  })

  // Checks that there is no collision over a large volume.
  it(
    "should generate unique IDs when called many times",
    () => {
      const count = 100_000

      const ids = new Set<string>()

      for (let i = 0; i < count; i++) {
        ids.add(generateCode())
      }

      expect(ids.size).toBe(count)
    },
    HEAVY_TEST_TIMEOUT,
  )

  // Freezing Date.now forces every ID into the same millisecond:
  // only the SEQUENCE counter can then tell them apart.
  it(
    "should remain unique when all IDs are generated in the same millisecond",
    () => {
      const fixedTimestamp = Date.now()

      vi.spyOn(Date, "now").mockReturnValue(fixedTimestamp)

      const count = 100_000

      const ids = new Set<string>()

      for (let i = 0; i < count; i++) {
        ids.add(generateCode())
      }

      expect(ids.size).toBe(count)
    },
    HEAVY_TEST_TIMEOUT,
  )

  // Same as above, with extra random characters (length > 32).
  it(
    "should remain unique with custom length in the same millisecond",
    () => {
      const fixedTimestamp = Date.now()

      vi.spyOn(Date, "now").mockReturnValue(fixedTimestamp)

      const count = 50_000

      const ids = new Set<string>()

      for (let i = 0; i < count; i++) {
        ids.add(generateCode(40))
      }

      expect(ids.size).toBe(count)
    },
    HEAVY_TEST_TIMEOUT,
  )

  // --- Argument validation ---

  // Below 32 characters, the fixed part (MACHINE + SESSION + PAYLOAD) does not fit.
  it("should throw if length is lower than 32", () => {
    expect(() => generateCode(31)).toThrow(RangeError)

    expect(() => generateCode(31)).toThrow(
      "length must be greater than or equal to 32",
    )
  })

  it("should throw for negative length", () => {
    expect(() => generateCode(-1)).toThrow(RangeError)
  })

  it("should throw if length is not an integer", () => {
    expect(() => generateCode(32.5)).toThrow(TypeError)

    expect(() => generateCode(32.5)).toThrow("length must be a safe integer")
  })

  it("should throw for NaN", () => {
    expect(() => generateCode(Number.NaN)).toThrow(TypeError)
  })

  it("should throw for Infinity", () => {
    expect(() => generateCode(Infinity)).toThrow(TypeError)
  })

  it("should throw for unsafe integers", () => {
    expect(() => generateCode(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError)
  })

  // --- Several lengths ---

  it("should generate valid IDs for multiple lengths", () => {
    const lengths = [32, 33, 40, 50, 64, 100]

    for (const length of lengths) {
      const id = generateCode(length)

      expect(id).toHaveLength(length)
      expect(id).toMatch(/^[A-Z1-9]+$/)
    }
  })

  it("should generate unique IDs with different lengths", () => {
    const id32 = generateCode(32)
    const id40 = generateCode(40)
    const id64 = generateCode(64)

    expect(id32).not.toBe(id40)
    expect(id40).not.toBe(id64)
    expect(id32).not.toBe(id64)
  })
})
