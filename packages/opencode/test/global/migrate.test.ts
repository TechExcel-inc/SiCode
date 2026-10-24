import fs from "fs"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Migrate } from "../../src/global"
import { tmpdir } from "../fixture/fixture"

describe("moving KloudCode's data to SiCode", () => {
  test("copies data, settings and state once, renames the database and settings, and keeps the old folders", async () => {
    await using tmp = await tmpdir()
    const roots = { data: path.join(tmp.path, "share"), config: path.join(tmp.path, "config"), state: path.join(tmp.path, "state") }
    const write = (file: string, text: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, text)
    }
    write(path.join(roots.data, "kloudcode", "kloudcode.db"), "db")
    write(path.join(roots.data, "kloudcode", "kloudcode.db-wal"), "wal")
    write(path.join(roots.data, "kloudcode", "auth.json"), '{"ead":{}}')
    write(path.join(roots.data, "kloudcode", "storage", "a.json"), "{}")
    write(path.join(roots.config, "kloudcode", "kloudcode.jsonc"), "{ }")

    const done = await Migrate.brand(roots)
    expect(done.toSorted()).toEqual([path.join(roots.config, "sicode"), path.join(roots.data, "sicode")])
    const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), "utf8")
    expect(read(roots.data, "sicode", "sicode.db")).toBe("db")
    expect(read(roots.data, "sicode", "sicode.db-wal")).toBe("wal")
    expect(read(roots.data, "sicode", "auth.json")).toBe('{"ead":{}}')
    expect(read(roots.data, "sicode", "storage", "a.json")).toBe("{}")
    expect(read(roots.config, "sicode", "sicode.jsonc")).toBe("{ }")
    expect(fs.existsSync(path.join(roots.data, "sicode", "kloudcode.db"))).toBe(false)
    // The old folders stay as they were, as a backup.
    expect(read(roots.data, "kloudcode", "kloudcode.db")).toBe("db")

    // Once moved, a later start leaves the new data alone.
    write(path.join(roots.data, "sicode", "sicode.db"), "newer")
    expect(await Migrate.brand(roots)).toEqual([])
    expect(read(roots.data, "sicode", "sicode.db")).toBe("newer")
  })

  test("does nothing on a computer that never had KloudCode", async () => {
    await using tmp = await tmpdir()
    const roots = { data: path.join(tmp.path, "share"), config: path.join(tmp.path, "config"), state: path.join(tmp.path, "state") }
    expect(await Migrate.brand(roots)).toEqual([])
    expect(fs.existsSync(path.join(roots.data, "sicode"))).toBe(false)
  })
})
