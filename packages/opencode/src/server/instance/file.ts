import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { Effect } from "effect"
import z from "zod"
import { AppRuntime } from "../../effect/app-runtime"
import { File } from "../../file"
import { Ripgrep } from "../../file/ripgrep"
import { LSP } from "../../lsp"
import { Instance } from "../../project/instance"
import { lazy } from "../../util/lazy"

export const FileRoutes = lazy(() =>
  new Hono()
    .get(
      "/find",
      describeRoute({
        summary: "Find text",
        description: "Search for text patterns across files in the project using ripgrep.",
        operationId: "find.text",
        responses: {
          200: {
            description: "Matches",
            content: {
              "application/json": {
                schema: resolver(Ripgrep.Match.shape.data.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          pattern: z.string(),
        }),
      ),
      async (c) => {
        const pattern = c.req.valid("query").pattern
        const result = await AppRuntime.runPromise(
          Ripgrep.Service.use((svc) => svc.search({ cwd: Instance.directory, pattern, limit: 10 })),
        )
        return c.json(result.items)
      },
    )
    .get(
      "/find/file",
      describeRoute({
        summary: "Find files",
        description: "Search for files or directories by name or pattern in the project directory.",
        operationId: "find.files",
        responses: {
          200: {
            description: "File paths",
            content: {
              "application/json": {
                schema: resolver(z.string().array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
          dirs: z.enum(["true", "false"]).optional(),
          type: z.enum(["file", "directory"]).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query").query
        const dirs = c.req.valid("query").dirs
        const type = c.req.valid("query").type
        const limit = c.req.valid("query").limit
        const results = await AppRuntime.runPromise(
          Effect.gen(function* () {
            return yield* File.Service.use((svc) =>
              svc.search({
                query,
                limit: limit ?? 10,
                dirs: dirs !== "false",
                type,
              }),
            )
          }),
        )
        return c.json(results)
      },
    )
    .get(
      "/find/symbol",
      describeRoute({
        summary: "Find symbols",
        description: "Search for workspace symbols like functions, classes, and variables using LSP.",
        operationId: "find.symbols",
        responses: {
          200: {
            description: "Symbols",
            content: {
              "application/json": {
                schema: resolver(LSP.Symbol.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
        }),
      ),
      async (c) => {
        return c.json([])
      },
    )
    .get(
      "/file",
      describeRoute({
        summary: "List files",
        description: "List files and directories in a specified path.",
        operationId: "file.list",
        responses: {
          200: {
            description: "Files and directories",
            content: {
              "application/json": {
                schema: resolver(File.Node.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        const content = await AppRuntime.runPromise(
          Effect.gen(function* () {
            return yield* File.Service.use((svc) => svc.list(path))
          }),
        )
        return c.json(content)
      },
    )
    .get(
      "/file/content",
      describeRoute({
        summary: "Read file",
        description: "Read the content of a specified file.",
        operationId: "file.read",
        responses: {
          200: {
            description: "File content",
            content: {
              "application/json": {
                schema: resolver(File.Content),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        const content = await AppRuntime.runPromise(
          Effect.gen(function* () {
            return yield* File.Service.use((svc) => svc.read(path))
          }),
        )
        return c.json(content)
      },
    )
    .post(
      "/file/content",
      describeRoute({
        summary: "Write file",
        description: "Write text content to a file inside the project, creating parent directories as needed.",
        operationId: "file.write",
        responses: {
          200: {
            description: "File written",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string(),
          content: z.string(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        await AppRuntime.runPromise(File.Service.use((svc) => svc.write(body.path, body.content)))
        return c.json(true)
      },
    )
    .post(
      "/file/move",
      describeRoute({
        summary: "Move file",
        description: "Rename or move a file inside the project. Fails if the destination exists.",
        operationId: "file.move",
        responses: {
          200: {
            description: "File moved",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          from: z.string(),
          to: z.string(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        await AppRuntime.runPromise(File.Service.use((svc) => svc.move(body.from, body.to)))
        return c.json(true)
      },
    )
    .delete(
      "/file/content",
      describeRoute({
        summary: "Delete file",
        description: "Delete a file inside the project.",
        operationId: "file.remove",
        responses: {
          200: {
            description: "File deleted",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        await AppRuntime.runPromise(File.Service.use((svc) => svc.remove(path)))
        return c.json(true)
      },
    )
    .get(
      "/file/status",
      describeRoute({
        summary: "Get file status",
        description: "Get the git status of all files in the project.",
        operationId: "file.status",
        responses: {
          200: {
            description: "File status",
            content: {
              "application/json": {
                schema: resolver(File.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const content = await AppRuntime.runPromise(
          Effect.gen(function* () {
            return yield* File.Service.use((svc) => svc.status())
          }),
        )
        return c.json(content)
      },
    ),
)
