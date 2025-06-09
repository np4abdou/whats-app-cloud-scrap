import fs from "fs"
import { PROGRESS_FILE } from "./constants.js"

// Progress tracking for downloads
export const activeDownloads = new Map()

// Enhanced progress tracking with message cleanup and real-time updates
export class ProgressTracker {
  constructor(sock, remoteJid, totalItems, itemType = "episodes") {
    this.sock = sock
    this.remoteJid = remoteJid
    this.totalItems = totalItems
    this.itemType = itemType
    this.completed = 0
    this.failed = 0
    this.currentItem = null
    this.startTime = Date.now()
    this.progressInterval = null
    this.lastUpdate = 0
    this.sessionId = `${remoteJid}_${Date.now()}`
    this.currentSessionId = null
    this.lastProgressMessage = null
    this.lastProgressMessageId = null
    this.lastProgressPercentage = 0
    this.isYouTube = false
    this.youtubeProgress = {
      progress: 0,
      total_size: "",
      downloaded_size: "",
      speed: "",
      eta: "",
      time_elapsed: "",
    }
  }

  async start() {
    await this.sock.sendMessage(this.remoteJid, {
      text: `🚀 Starting ${this.itemType} download...\n📊 Total: ${this.totalItems}\n⏰ ${new Date().toLocaleTimeString()}`,
    })

    // Set up progress update interval (every 5 seconds)
    this.progressInterval = setInterval(() => {
      this.checkAndSendProgressUpdate()
    }, 5000)

    activeDownloads.set(this.sessionId, this)
  }

  async updateCurrentItem(itemName, status = "downloading", sessionId = null) {
    this.currentItem = itemName
    this.currentSessionId = sessionId

    // Force immediate progress update when item changes
    await this.checkAndSendProgressUpdate(true)
  }

  // Update YouTube progress directly
  updateYouTubeProgress(progressData) {
    this.isYouTube = true
    this.youtubeProgress = { ...this.youtubeProgress, ...progressData }
  }

  async checkAndSendProgressUpdate(force = false) {
    const now = Date.now()

    // Only update if forced or if 5 seconds have passed since last update
    if (force || now - this.lastUpdate >= 5000) {
      await this.sendProgressUpdate()
      this.lastUpdate = now
    }
  }

  async sendProgressUpdate(status = "in progress") {
    try {
      let progressData = null

      if (this.isYouTube) {
        progressData = this.youtubeProgress
      } else if (this.currentSessionId) {
        progressData = await this.getPythonProgress(this.currentSessionId)
      }

      if (!progressData || !progressData.progress) return

      // Skip if progress hasn't changed significantly
      if (this.lastProgressMessage && Math.abs(progressData.progress - this.lastProgressPercentage) < 1) {
        return
      }

      // Format a clean, emoji-rich progress message
      let progressText = `📥 *Downloading ${this.isYouTube ? "Video" : "Anime"}*\n`

      if (this.currentItem) {
        progressText += `🎬 ${this.currentItem}\n\n`
      }

      // Add download stats with emojis
      if (progressData.progress) {
        if (progressData.total_size) {
          progressText += `⏳ ${progressData.progress.toFixed(1)}% of ${progressData.total_size}`
        } else {
          progressText += `⏳ ${progressData.progress.toFixed(1)}%`
        }
      }

      if (progressData.speed) {
        progressText += `\n⚡ ${progressData.speed}`
      }

      if (progressData.time_elapsed) {
        progressText += ` • ⏱️ ${progressData.time_elapsed}`
      }

      if (progressData.eta && progressData.eta !== "00:00") {
        progressText += ` • ⌛ ${progressData.eta}`
      }

      // Delete previous progress message if it exists
      if (this.lastProgressMessageId) {
        try {
          await this.sock.sendMessage(this.remoteJid, { delete: this.lastProgressMessageId })
          // Add small delay to ensure deletion completes
          await new Promise((resolve) => setTimeout(resolve, 100))
        } catch (error) {
          // Ignore deletion errors
        }
      }

      // Send new progress message
      const sentMessage = await this.sock.sendMessage(this.remoteJid, { text: progressText })
      this.lastProgressMessageId = sentMessage.key
      this.lastProgressMessage = progressText
      this.lastProgressPercentage = progressData.progress
    } catch (error) {
      console.log("Progress update failed:", error.message)
    }
  }

  async getPythonProgress(sessionId) {
    try {
      if (!fs.existsSync(PROGRESS_FILE)) return null
      const progressData = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"))
      return progressData[sessionId] || null
    } catch (error) {
      return null
    }
  }

  async itemCompleted(itemName, success = true) {
    if (success) {
      this.completed++
      await this.updateCurrentItem(itemName, "completed")
    } else {
      this.failed++
      await this.updateCurrentItem(itemName, "failed")
    }
  }

  async finish() {
    if (this.progressInterval) clearInterval(this.progressInterval)
    activeDownloads.delete(this.sessionId)

    // Delete the last progress message
    if (this.lastProgressMessageId) {
      try {
        await this.sock.sendMessage(this.remoteJid, { delete: this.lastProgressMessageId })
      } catch (error) {
        // Ignore deletion errors
      }
    }

    const elapsed = Math.floor((Date.now() - this.startTime) / 1000)
    const timeStr = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, "0")}`

    let finalText = `✅ *Download Complete!*\n`
    finalText += `📥 ${this.completed}/${this.totalItems} files\n`
    finalText += `⏱️ Total time: ${timeStr}`

    if (this.failed > 0) finalText += `\n❌ Failed: ${this.failed}`

    await this.sock.sendMessage(this.remoteJid, { text: finalText })
  }
}

// Parse YouTube download progress from yt-dlp output with better stream handling
export function parseYouTubeProgress(line, progressTracker) {
  try {
    if (line.includes("[download]") && line.includes("%")) {
      // Skip if this is a fragment download or audio-only stream
      if (line.includes("fragment") || line.includes("audio only")) {
        return
      }

      const percentMatch = line.match(/(\d+\.?\d*)%/)
      if (percentMatch) {
        const progress = Number.parseFloat(percentMatch[1])

        // Skip if we've already reached 100% to avoid duplicates
        if (progress >= 100 && progressTracker.youtubeProgress.progress >= 100) {
          return
        }

        const sizeMatch = line.match(/of\s+([0-9.]+[KMGT]?iB)/)
        const total_size = sizeMatch ? sizeMatch[1] : ""

        const downloadedMatch = line.match(/(\d+\.?\d*[KMGT]?iB)\s+of/)
        const downloaded_size = downloadedMatch ? downloadedMatch[1] : ""

        const speedMatch = line.match(/at\s+([0-9.]+[KMGT]?iB\/s)/)
        const speed = speedMatch ? speedMatch[1] : ""

        const etaMatch = line.match(/ETA\s+([0-9:]+)/)
        const eta = etaMatch ? etaMatch[1] : ""

        // Calculate elapsed time
        const elapsed_seconds = Math.floor((Date.now() - progressTracker.startTime) / 1000)
        const minutes = Math.floor(elapsed_seconds / 60)
        const seconds = elapsed_seconds % 60
        const time_elapsed = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`

        // Only update if this is meaningful progress
        if (total_size && progress > progressTracker.youtubeProgress.progress) {
          progressTracker.updateYouTubeProgress({
            progress,
            total_size,
            downloaded_size,
            speed,
            eta,
            time_elapsed,
          })
        }
      }
    }
  } catch (error) {
    console.log("YouTube progress parsing error:", error.message)
  }
}

// Progress monitoring service with more frequent updates
export function startProgressMonitoring() {
  setInterval(async () => {
    for (const [sessionId, tracker] of activeDownloads) {
      if (tracker.currentSessionId || tracker.isYouTube) {
        await tracker.checkAndSendProgressUpdate(true)
      }
    }
  }, 5000) // Check every 5 seconds
}
