import { generateCode } from "../dist/index.mjs"

const DURATION_MS = 3000
const LENGTHS = [32, 64, 128]

for (const length of LENGTHS) {
  // Warm-up so the JIT has compiled the hot path.
  for (let i = 0; i < 5_000; i++) {
    generateCode(length)
  }

  let count = 0
  const start = process.hrtime.bigint()
  const deadline = Date.now() + DURATION_MS

  while (Date.now() < deadline) {
    for (let i = 0; i < 1_000; i++) {
      generateCode(length)
    }

    count += 1_000
  }

  const seconds = Number(process.hrtime.bigint() - start) / 1e9

  console.log(
    `length ${String(length).padStart(3)}: ${Math.round(count / seconds).toLocaleString("en-US")} IDs/s`,
  )
}
