import fs from "fs"
import path from "path"
import { TMP_DIR, CHATS_FILE } from "./constants.js"
import { getDirectorySize, formatBytes, getWorkspaceFiles } from "./utils.js"

// Store all chat JIDs for broadcast
export const savedChats = new Set()

// Load saved chats
export function loadSavedChats() {
  try {
    if (fs.existsSync(CHATS_FILE)) {
      const data = JSON.parse(fs.readFileSync(CHATS_FILE, "utf8"))
      data.forEach((chat) => savedChats.add(chat))
      console.log(`📱 Loaded ${savedChats.size} saved chats`)
    }
  } catch (error) {
    console.error("Error loading saved chats:", error)
  }
}

// Save chats to file
export function saveChatsList() {
  try {
    fs.writeFileSync(CHATS_FILE, JSON.stringify([...savedChats], null, 2))
  } catch (error) {
    console.error("Error saving chats:", error)
  }
}

// Add chat to saved list
export function addSavedChat(jid) {
  if (!savedChats.has(jid)) {
    savedChats.add(jid)
    saveChatsList()
  }
}

// Clean up temporary files only
export async function cleanupTempFiles() {
  try {
    if (fs.existsSync(TMP_DIR)) {
      const files = fs.readdirSync(TMP_DIR)
      let deletedCount = 0
      for (const file of files) {
        try {
          const filePath = path.join(TMP_DIR, file)
          fs.unlinkSync(filePath)
          deletedCount++
        } catch (error) {
          // Ignore individual file deletion errors
        }
      }
      console.log(`🗑️ Cleaned up ${deletedCount} temporary files`)
      return deletedCount
    }
    return 0
  } catch (error) {
    console.log(`⚠️ Temp cleanup failed: ${error.message}`)
    return 0
  }
}

// Get storage information
export function getStorageInfo() {
  const workspaceSizeBytes = getDirectorySize(process.cwd() + "/files")
  const tempSizeBytes = getDirectorySize(TMP_DIR)
  const animeSizeBytes = getDirectorySize("/home/container/new/files")
  const musicSizeBytes = getDirectorySize(path.join(process.cwd(), "downloads"))

  return {
    workspaceSize: formatBytes(workspaceSizeBytes),
    tempSize: formatBytes(tempSizeBytes),
    animeSize: formatBytes(animeSizeBytes),
    musicSize: formatBytes(musicSizeBytes),
    filesCount: getWorkspaceFiles().length,
    savedChatsCount: savedChats.size,
    hasCookies: fs.existsSync(path.join(process.cwd(), "youtube_cookies.txt")),
  }
}
