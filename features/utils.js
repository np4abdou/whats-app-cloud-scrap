import fs from "fs"
import path from "path"
import fetch from "node-fetch"
import { FILES_DIR, TMP_DIR, ANIME_DOWNLOAD_DIR } from "./constants.js"

// Ensure all directories exist
export function ensureDirectories() {
  const directories = [FILES_DIR, TMP_DIR, ANIME_DOWNLOAD_DIR]
  directories.forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  })
}

// Format bytes to human readable format
export function formatBytes(bytes) {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

// Get file size with formatting
export function getFileSize(filePath) {
  try {
    if (!fs.existsSync(filePath)) return "Not Found"
    const stats = fs.statSync(filePath)
    return formatBytes(stats.size)
  } catch (error) {
    return "Unknown"
  }
}

// Get directory size
export function getDirectorySize(dirPath) {
  let totalSize = 0
  try {
    const files = fs.readdirSync(dirPath)
    for (const file of files) {
      const filePath = path.join(dirPath, file)
      const stats = fs.statSync(filePath)
      if (stats.isFile()) {
        totalSize += stats.size
      }
    }
  } catch (error) {
    console.error("Error calculating directory size:", error)
  }
  return totalSize
}

// Download image from URL
export async function downloadImage(url) {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch (error) {
    console.error(`Failed to download image: ${error.message}`)
    return null
  }
}

// Helper to get file mimetypes
export function getMimetype(filename) {
  const ext = path.extname(filename).toLowerCase()
  switch (ext) {
    case ".pdf":
      return "application/pdf"
    case ".doc":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    case ".txt":
      return "text/plain"
    case ".jpg":
      return "image/jpeg"
    case ".png":
      return "image/png"
    case ".gif":
      return "image/gif"
    case ".mp3":
      return "audio/mpeg"
    case ".mp4":
      return "video/mp4"
    default:
      return "application/octet-stream"
  }
}

// Get workspace files
export function getWorkspaceFiles() {
  try {
    const files = fs.readdirSync(FILES_DIR)
    return files.filter((file) => fs.statSync(path.join(FILES_DIR, file)).isFile())
  } catch (error) {
    console.error("Error reading files:", error)
    return []
  }
}

// Format duration for YouTube videos
export function formatDuration(duration) {
  if (duration === "N/A") return "N/A"
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return duration
  const hours = Number.parseInt(match[1] || 0)
  const minutes = Number.parseInt(match[2] || 0)
  const seconds = Number.parseInt(match[3] || 0)
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
  } else {
    return `${minutes}:${seconds.toString().padStart(2, "0")}`
  }
}

// Format numbers for display
export function formatNumber(num) {
  if (num === "N/A") return "N/A"
  const number = Number.parseInt(num)
  if (isNaN(number)) return "N/A"
  if (number >= 1000000000) return (number / 1000000000).toFixed(1) + "B"
  if (number >= 1000000) return (number / 1000000).toFixed(1) + "M"
  if (number >= 1000) return (number / 1000).toFixed(1) + "K"
  return number.toString()
}
