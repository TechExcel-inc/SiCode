import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { Filesystem } from "../util/filesystem"
import { Brand } from "../brand"

const app = Brand.app

const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

export namespace Global {
  export const Path = {
    // Allow override via OPENCODE_TEST_HOME for test isolation
    get home() {
      return process.env.OPENCODE_TEST_HOME || os.homedir()
    },
    data,
    bin: path.join(cache, "bin"),
    log: path.join(data, "log"),
    cache,
    config,
    state,
  }
}

export namespace Migrate {
  /**
   * SiCode was KloudCode: on the first start under the new name, its data, settings and state are
   * copied (not moved, so the old folders stay as a backup) and the database and settings files take
   * the new names. A folder that already exists under the new name is left alone.
   */
  export async function brand(roots: { data: string; config: string; state: string }) {
    const done: string[] = []
    for (const root of [roots.data, roots.config, roots.state]) {
      const from = path.join(root, Brand.legacy.app)
      const to = path.join(root, Brand.app)
      if ((await Filesystem.exists(to)) || !(await Filesystem.exists(from))) continue
      await fs.cp(from, to, { recursive: true, preserveTimestamps: true })
      done.push(to)
    }
    const data = path.join(roots.data, Brand.app)
    const config = path.join(roots.config, Brand.app)
    const renames = [
      ...["", "-wal", "-shm"].map((end) => [path.join(data, Brand.legacy.db + end), path.join(data, Brand.db + end)]),
      ...[".json", ".jsonc"].map((end) => [path.join(config, Brand.legacy.config + end), path.join(config, Brand.config + end)]),
    ]
    for (const [from, to] of renames) {
      if (!done.some((dir) => from.startsWith(dir))) continue
      if ((await Filesystem.exists(from)) && !(await Filesystem.exists(to))) await fs.rename(from, to)
    }
    return done
  }
}

await Migrate.brand({ data: xdgData!, config: xdgConfig!, state: xdgState! })

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
])

const CACHE_VERSION = "21"

const version = await Filesystem.readText(path.join(Global.Path.cache, "version")).catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) {}
  await Filesystem.write(path.join(Global.Path.cache, "version"), CACHE_VERSION)
}
