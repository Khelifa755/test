import { Effect } from "effect"
import * as path from "path"
import * as os from "os"
import * as fs from "fs/promises"

export interface UndoRecord {
  timestamp: number
  sessionId: string
  filePath: string
  content: string
}

export class UndoManager {
  private static getUndoDir(): string {
    return path.join(os.tmpdir(), "kilo_undo")
  }

  private static getSessionDir(sessionId: string): string {
    return path.join(this.getUndoDir(), sessionId)
  }

  private static getFileHistoryPath(filePath: string): string {
    // Hash or encode the file path to make it a valid filename
    const safeName = encodeURIComponent(filePath)
    return path.join(this.getUndoDir(), "files", safeName, "history.json")
  }

  static record(filePath: string, contentOld: string, sessionId: string) {
    return Effect.promise(async () => {
      const record: UndoRecord = {
        timestamp: Date.now(),
        sessionId,
        filePath,
        content: contentOld,
      }

      // 1. Save to session history (for `undo --all`)
      const sessionDir = UndoManager.getSessionDir(sessionId)
      await fs.mkdir(sessionDir, { recursive: true }).catch(() => {})
      const sessionFile = path.join(sessionDir, `${Date.now()}-${encodeURIComponent(path.basename(filePath))}.json`)
      await fs.writeFile(sessionFile, JSON.stringify(record, null, 2)).catch(() => {})

      // 1.5 Save latest session ID
      await fs.mkdir(UndoManager.getUndoDir(), { recursive: true }).catch(() => {})
      const latestSessionFile = path.join(UndoManager.getUndoDir(), "latest_session.txt")
      await fs.writeFile(latestSessionFile, sessionId).catch(() => {})

      // 1.6 Save to global edit log (for `undo` without args)
      const globalLogFile = path.join(UndoManager.getUndoDir(), "global_log.json")
      let globalLog: UndoRecord[] = []
      try {
        const text = await fs.readFile(globalLogFile, "utf-8")
        globalLog = JSON.parse(text)
      } catch {
        globalLog = []
      }
      globalLog.push(record)
      if (globalLog.length > 100) globalLog = globalLog.slice(globalLog.length - 100)
      await fs.writeFile(globalLogFile, JSON.stringify(globalLog, null, 2)).catch(() => {})

      // 2. Save to file history (for `undo`)
      const historyFile = UndoManager.getFileHistoryPath(filePath)
      await fs.mkdir(path.dirname(historyFile), { recursive: true }).catch(() => {})
      let history: UndoRecord[] = []
      try {
        const text = await fs.readFile(historyFile, "utf-8")
        history = JSON.parse(text)
      } catch {
        history = []
      }

      history.push(record)
      // Keep only last 10 edits
      if (history.length > 10) {
        history = history.slice(history.length - 10)
      }

      await fs.writeFile(historyFile, JSON.stringify(history, null, 2)).catch(() => {})
    })
  }

  static getLastEdit(filePath: string) {
    return Effect.promise(async () => {
      const historyFile = UndoManager.getFileHistoryPath(filePath)
      try {
        const text = await fs.readFile(historyFile, "utf-8")
        const history: UndoRecord[] = JSON.parse(text)
        return history.length > 0 ? history[history.length - 1] : undefined
      } catch {
        return undefined
      }
    })
  }

  static popLastEdit(filePath: string) {
    return Effect.promise(async () => {
      const historyFile = UndoManager.getFileHistoryPath(filePath)
      try {
        const text = await fs.readFile(historyFile, "utf-8")
        const history: UndoRecord[] = JSON.parse(text)
        if (history.length === 0) return undefined
        const last = history.pop()
        await fs.writeFile(historyFile, JSON.stringify(history, null, 2))
        return last
      } catch {
        return undefined
      }
    })
  }

  static popGlobalLastEdit() {
    return Effect.promise(async () => {
      const globalLogFile = path.join(UndoManager.getUndoDir(), "global_log.json")
      try {
        const text = await fs.readFile(globalLogFile, "utf-8")
        const history: UndoRecord[] = JSON.parse(text)
        if (history.length === 0) return undefined
        const last = history.pop()
        await fs.writeFile(globalLogFile, JSON.stringify(history, null, 2))
        
        // Also pop from file history to keep in sync
        if (last) {
          const fileHistory = UndoManager.getFileHistoryPath(last.filePath)
          try {
            const fileText = await fs.readFile(fileHistory, "utf-8")
            const fHistory: UndoRecord[] = JSON.parse(fileText)
            fHistory.pop()
            await fs.writeFile(fileHistory, JSON.stringify(fHistory, null, 2))
          } catch {}
        }
        return last
      } catch {
        return undefined
      }
    })
  }

  static getLatestSessionId() {
    return Effect.promise(async () => {
      const file = path.join(UndoManager.getUndoDir(), "latest_session.txt")
      try {
        return await fs.readFile(file, "utf-8")
      } catch {
        return undefined
      }
    })
  }

  static getSessionEdits(sessionId: string) {
    return Effect.promise(async () => {
      const sessionDir = UndoManager.getSessionDir(sessionId)
      try {
        const files = await fs.readdir(sessionDir)
        const records: UndoRecord[] = []
        
        for (const file of files) {
          if (!file.endsWith(".json")) continue
          try {
            const text = await fs.readFile(path.join(sessionDir, file), "utf-8")
            records.push(JSON.parse(text))
          } catch {}
        }
        
        // Sort by timestamp descending
        return records.sort((a, b) => b.timestamp - a.timestamp)
      } catch {
        return []
      }
    })
  }

  static clearSession(sessionId: string) {
    return Effect.promise(async () => {
      const sessionDir = UndoManager.getSessionDir(sessionId)
      try {
        await fs.rm(sessionDir, { recursive: true, force: true })
      } catch {}
    })
  }
}
