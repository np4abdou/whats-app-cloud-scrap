import fs from "fs"
import path from "path"
import { FILES_DIR } from "./constants.js"
import { getFileSize, getMimetype, getWorkspaceFiles, formatBytes } from "./utils.js"

// Send file list with upload/delete options
export async function sendFileList(sock, remoteJid, files) {
  if (files.length === 0) {
    await sock.sendMessage(remoteJid, { text: "📁 No files available in the files directory." })
    return
  }

  let fileList = "📁 *Available Files:*\n\n"
  files.forEach((file, i) => {
    const filePath = path.join(FILES_DIR, file)
    const fileSize = getFileSize(filePath)
    fileList += `${i + 1}. 📄 ${file}\n   📊 ${fileSize}\n\n`
  })

  fileList += `📝 *File Operations:*\n• /upload <number> - Send file\n• /delete <number> - Delete file\n• /delete <number>,<number> - Delete multiple\n\n*Examples:*\n• /upload 1 - Send first file\n• /delete 3 - Delete third file\n• /delete 1,3,5 - Delete files 1, 3, and 5`

  await sock.sendMessage(remoteJid, { text: fileList })
}

// Handle file upload by number
export async function handleFileUpload(sock, messageInfo, fileNumber, userStates) {
  const { remoteJid } = messageInfo
  const userState = userStates.get(remoteJid)

  if (!userState || userState.state !== "selecting_file") {
    await sock.sendMessage(remoteJid, { text: "❌ No file list active. Use /files command first." })
    return
  }

  const files = userState.files
  const fileIndex = Number.parseInt(fileNumber) - 1

  if (isNaN(fileIndex) || fileIndex < 0 || fileIndex >= files.length) {
    await sock.sendMessage(remoteJid, { text: `❌ Invalid file number. Choose 1-${files.length}` })
    return
  }

  const selectedFile = files[fileIndex]
  const filePath = path.join(FILES_DIR, selectedFile)

  try {
    if (!fs.existsSync(filePath)) {
      await sock.sendMessage(remoteJid, { text: "❌ File not found. It may have been moved or deleted." })
      return
    }

    const fileSize = getFileSize(filePath)
    await sock.sendMessage(remoteJid, { text: `📤 Uploading: ${selectedFile}\n📊 Size: ${fileSize}` })

    await sock.sendMessage(remoteJid, {
      document: { url: filePath },
      fileName: selectedFile,
      mimetype: getMimetype(selectedFile),
      caption: `📄 ${selectedFile}\n📊 Size: ${fileSize}`,
    })

    await sock.sendMessage(remoteJid, { text: `✅ File uploaded successfully!` })
    userStates.delete(remoteJid)
  } catch (error) {
    console.error(`Error uploading file ${selectedFile}:`, error)
    await sock.sendMessage(remoteJid, { text: `❌ Upload failed: ${error.message}` })
  }
}

// Enhanced file deletion handler for multiple files
export async function handleFileDelete(sock, messageInfo, fileNumbers, userStates) {
  const { remoteJid } = messageInfo
  const userState = userStates.get(remoteJid)

  if (!userState || userState.state !== "selecting_file") {
    await sock.sendMessage(remoteJid, { text: "❌ No file list active. Use /files command first." })
    return
  }

  const files = userState.files
  const numberStrings = fileNumbers.split(",").map((n) => n.trim())
  const fileIndices = []
  const filesToDelete = []

  for (const numStr of numberStrings) {
    const fileIndex = Number.parseInt(numStr) - 1

    if (isNaN(fileIndex) || fileIndex < 0 || fileIndex >= files.length) {
      await sock.sendMessage(remoteJid, { text: `❌ Invalid file number: ${numStr}. Choose 1-${files.length}` })
      return
    }

    if (fileIndices.includes(fileIndex)) {
      await sock.sendMessage(remoteJid, { text: `❌ Duplicate file number: ${numStr}` })
      return
    }

    fileIndices.push(fileIndex)
    filesToDelete.push({
      index: fileIndex,
      name: files[fileIndex],
      path: path.join(FILES_DIR, files[fileIndex]),
    })
  }

  try {
    const missingFiles = filesToDelete.filter((file) => !fs.existsSync(file.path))
    if (missingFiles.length > 0) {
      await sock.sendMessage(remoteJid, {
        text: `❌ Some files not found: ${missingFiles.map((f) => f.name).join(", ")}`,
      })
      return
    }

    const totalSize = filesToDelete.reduce((sum, file) => {
      try {
        return sum + fs.statSync(file.path).size
      } catch {
        return sum
      }
    }, 0)

    let confirmText = `⚠️ *Delete Confirmation*\n\n🗑️ Files to delete (${filesToDelete.length}):\n\n`

    filesToDelete.forEach((file, index) => {
      const fileSize = getFileSize(file.path)
      confirmText += `${index + 1}. 📄 ${file.name}\n   📊 ${fileSize}\n\n`
    })

    confirmText += `📊 Total size: ${formatBytes(totalSize)}\n\n🗑️ This action cannot be undone!\n\n📝 Reply 'YES' to confirm or 'NO' to cancel`

    await sock.sendMessage(remoteJid, { text: confirmText })

    userStates.set(remoteJid, {
      state: "confirming_delete",
      filesToDelete: filesToDelete,
      files: files,
    })
  } catch (error) {
    console.error(`Error preparing file deletion:`, error)
    await sock.sendMessage(remoteJid, { text: `❌ Delete preparation failed: ${error.message}` })
  }
}

// Enhanced file deletion confirmation
export async function confirmFileDelete(sock, messageInfo, confirmation, userStates) {
  const { remoteJid } = messageInfo
  const userState = userStates.get(remoteJid)

  if (!userState || userState.state !== "confirming_delete") {
    await sock.sendMessage(remoteJid, { text: "❌ No deletion pending. Use /delete command first." })
    return
  }

  const { filesToDelete } = userState

  if (confirmation.toUpperCase() === "YES") {
    try {
      let deletedCount = 0
      let failedCount = 0
      const deletedFiles = []
      const failedFiles = []

      for (const file of filesToDelete) {
        try {
          fs.unlinkSync(file.path)
          deletedFiles.push(file.name)
          deletedCount++
        } catch (error) {
          failedFiles.push(file.name)
          failedCount++
        }
      }

      let resultText = `📊 Deletion Results:\n\n✅ Successfully deleted: ${deletedCount}/${filesToDelete.length} files\n\n`

      if (deletedFiles.length > 0) {
        resultText += `🗑️ Deleted files:\n${deletedFiles.map((name) => `• ${name}`).join("\n")}\n\n`
      }

      if (failedFiles.length > 0) {
        resultText += `❌ Failed to delete:\n${failedFiles.map((name) => `• ${name}`).join("\n")}\n\n`
      }

      resultText += `💾 Storage space freed up`

      await sock.sendMessage(remoteJid, { text: resultText })
      userStates.delete(remoteJid)
    } catch (error) {
      console.error(`Error during file deletion:`, error)
      await sock.sendMessage(remoteJid, { text: `❌ Deletion process failed: ${error.message}` })
      userStates.delete(remoteJid)
    }
  } else if (confirmation.toUpperCase() === "NO") {
    const fileNames = filesToDelete.map((f) => f.name).join(", ")
    await sock.sendMessage(remoteJid, { text: `❌ Deletion cancelled\n\n📄 Files preserved: ${fileNames}` })

    userStates.set(remoteJid, {
      state: "selecting_file",
      files: userState.files,
    })
  } else {
    await sock.sendMessage(remoteJid, {
      text: `❌ Invalid response\n\n📝 Please reply 'YES' to confirm or 'NO' to cancel`,
    })
  }
}

// Handle file selection
export async function handleFileSelection(sock, messageInfo, selection, userStates) {
  const { remoteJid } = messageInfo
  const files = getWorkspaceFiles()

  if (selection.toLowerCase() === "cancel") {
    userStates.delete(remoteJid)
    await sock.sendMessage(remoteJid, { text: "❌ File browser cancelled." })
    return
  }

  const fileIndex = Number.parseInt(selection) - 1

  if (isNaN(fileIndex) || fileIndex < 0 || fileIndex >= files.length) {
    await sock.sendMessage(remoteJid, { text: "❌ Invalid number. Please try again." })
    return
  }

  const selectedFile = files[fileIndex]
  const filePath = path.join(FILES_DIR, selectedFile)
  userStates.delete(remoteJid)

  try {
    if (!fs.existsSync(filePath)) {
      await sock.sendMessage(remoteJid, { text: "❌ File not found. It may have been moved or deleted." })
      return
    }

    const fileSize = getFileSize(filePath)
    await sock.sendMessage(remoteJid, { text: `📤 Sending: ${selectedFile}\n📊 Size: ${fileSize}` })

    await sock.sendMessage(remoteJid, {
      document: { url: filePath },
      fileName: selectedFile,
      mimetype: getMimetype(selectedFile),
      caption: `📄 ${selectedFile}\n📊 Size: ${fileSize}`,
    })

    await sock.sendMessage(remoteJid, { text: `✅ Sent "${selectedFile}" successfully.` })
  } catch (error) {
    console.error(`Error sending file ${selectedFile}:`, error)
    await sock.sendMessage(remoteJid, { text: `❌ Couldn't send "${selectedFile}".` })
  }
}
