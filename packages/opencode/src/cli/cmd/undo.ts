import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { UndoManager, type UndoRecord } from "../../kilocode/tool/undo-state"
import * as fs from "fs/promises"
import { createTwoFilesPatch } from "diff"
import * as readline from "readline"

export const UndoCommand = effectCmd({
  command: "undo",
  describe: "revert the last file edit made by the agent",
  builder: (yargs) =>
    yargs.option("all", {
      describe: "revert all files edited in the last session",
      type: "boolean",
    }),
  handler: Effect.fn("Cli.undo")(function* (args) {
    yield* Effect.promise(async () => {
      if (args.all) {
        const sessionId = await Effect.runPromise(UndoManager.getLatestSessionId())
        if (!sessionId) {
          console.log("No recent session found to revert.")
          return
        }

        const edits = await Effect.runPromise(UndoManager.getSessionEdits(sessionId))
        if (edits.length === 0) {
          console.log(`No edits found for session ${sessionId}.`)
          return
        }

        console.log(`Found ${edits.length} edits in the last session.`)
        // Group by file, keeping only the earliest edit (so we revert to original state)
        const earliestEdits = new Map<string, UndoRecord>()
        for (const edit of edits) {
          // Since we want to revert to before the session started, we need the first edit made to each file
          const existing = earliestEdits.get(edit.filePath)
          if (!existing || edit.timestamp < existing.timestamp) {
            earliestEdits.set(edit.filePath, edit)
          }
        }

        const filesToRevert = Array.from(earliestEdits.values())
        console.log(`Reverting ${filesToRevert.length} unique files to their state before the session...`)

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        const answer = await new Promise<string>((resolve) => {
          rl.question("Are you sure you want to revert all these files? (y/N) ", (ans) => {
            rl.close()
            resolve(ans)
          })
        })

        if (answer.toLowerCase() !== "y") {
          console.log("Aborted.")
          return
        }

        for (const edit of filesToRevert) {
          console.log(`Reverting ${edit.filePath}...`)
          if (edit.content === "") {
             // It was likely an add
             await fs.rm(edit.filePath, { force: true }).catch(() => {})
          } else {
             await fs.writeFile(edit.filePath, edit.content).catch(() => {})
          }
        }

        await Effect.runPromise(UndoManager.clearSession(sessionId))
        console.log("Session reverted successfully.")
      } else {
        const lastEdit = await Effect.runPromise(UndoManager.popGlobalLastEdit())
        if (!lastEdit) {
          console.log("No recent edits found to revert.")
          return
        }

        let currentContent = ""
        try {
          currentContent = await fs.readFile(lastEdit.filePath, "utf-8")
        } catch {}

        const diff = createTwoFilesPatch(
          lastEdit.filePath,
          lastEdit.filePath,
          currentContent,
          lastEdit.content,
          "Current",
          "Reverted (Original)",
        )

        console.log(`\nReverting edit for: ${lastEdit.filePath}\n`)
        console.log("Diff of what will change (applying this patch):")
        console.log(diff)
        console.log()

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        const answer = await new Promise<string>((resolve) => {
          rl.question("Confirm revert? (y/N) ", (ans) => {
            rl.close()
            resolve(ans)
          })
        })

        if (answer.toLowerCase() !== "y") {
          console.log("Aborted. The edit was not reverted.")
          return
        }

        if (lastEdit.content === "") {
          await fs.rm(lastEdit.filePath, { force: true }).catch(() => {})
        } else {
          await fs.writeFile(lastEdit.filePath, lastEdit.content).catch(() => {})
        }

        console.log(`Successfully reverted ${lastEdit.filePath}.`)
      }
    })
  }),
})
