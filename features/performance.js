import { EventEmitter } from "events"
import fs from "fs"
import { promisify } from "util"

// Performance optimization utilities
export class PerformanceManager extends EventEmitter {
  constructor() {
    super()
    this.connectionPool = new Map()
    this.messageQueue = []
    this.isProcessingQueue = false
    this.batchSize = 5
    this.maxConcurrency = 10
    this.activeOperations = 0
  }

  // Optimized batch message sending
  async sendMessagesBatch(sock, messages) {
    const batches = this.chunkArray(messages, this.batchSize)
    const promises = batches.map((batch) => this.processBatch(sock, batch))
    return Promise.all(promises)
  }

  // Process batch of messages concurrently
  async processBatch(sock, batch) {
    const promises = batch.map(async (messageData) => {
      try {
        return await sock.sendMessage(messageData.remoteJid, messageData.content)
      } catch (error) {
        console.error(`Failed to send message: ${error.message}`)
        return null
      }
    })
    return Promise.allSettled(promises)
  }

  // Chunk array into smaller arrays
  chunkArray(array, size) {
    const chunks = []
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size))
    }
    return chunks
  }

  // Optimized file operations with streams
  async streamFile(filePath) {
    const readFile = promisify(fs.readFile)
    return readFile(filePath)
  }

  // Connection pooling for HTTP requests
  getConnection(url) {
    const domain = new URL(url).hostname
    if (!this.connectionPool.has(domain)) {
      this.connectionPool.set(domain, {
        keepAlive: true,
        maxSockets: 10,
        timeout: 30000,
      })
    }
    return this.connectionPool.get(domain)
  }

  // Throttle concurrent operations
  async throttleOperation(operation) {
    while (this.activeOperations >= this.maxConcurrency) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    this.activeOperations++
    try {
      return await operation()
    } finally {
      this.activeOperations--
    }
  }

  // Optimized progress tracking with debouncing
  createOptimizedProgressTracker(sock, remoteJid, totalItems, itemType) {
    return new OptimizedProgressTracker(sock, remoteJid, totalItems, itemType)
  }
}

// Optimized progress tracker with minimal overhead
export class OptimizedProgressTracker {
  constructor(sock, remoteJid, totalItems, itemType = "items") {
    this.sock = sock
    this.remoteJid = remoteJid
    this.totalItems = totalItems
    this.itemType = itemType
    this.completed = 0
    this.failed = 0
    this.startTime = Date.now()
    this.lastUpdate = 0
    this.lastProgressMessageId = null
    this.updateThreshold = 2000 // 2 seconds minimum between updates
    this.progressData = {
      progress: 0,
      total_size: "",
      downloaded_size: "",
      speed: "",
      eta: "",
      time_elapsed: "",
    }
  }

  async start() {
    const message = await this.sock.sendMessage(this.remoteJid, {
      text: `🚀 Starting ${this.itemType} processing...\n📊 Total: ${this.totalItems}`,
    })
    this.lastProgressMessageId = message.key
  }

  // Debounced progress update
  async updateProgress(progressData) {
    const now = Date.now()
    if (now - this.lastUpdate < this.updateThreshold) return

    this.progressData = { ...this.progressData, ...progressData }
    this.lastUpdate = now

    // Delete previous message and send new one
    if (this.lastProgressMessageId) {
      try {
        await this.sock.sendMessage(this.remoteJid, { delete: this.lastProgressMessageId })
      } catch (error) {
        // Ignore deletion errors
      }
    }

    const progressText = this.formatProgressText()
    const message = await this.sock.sendMessage(this.remoteJid, { text: progressText })
    this.lastProgressMessageId = message.key
  }

  formatProgressText() {
    const { progress, total_size, speed, eta } = this.progressData
    let text = `📥 Processing ${this.itemType}...\n`

    if (progress > 0) {
      text += `⏳ ${progress.toFixed(1)}%`
      if (total_size) text += ` of ${total_size}`
      if (speed) text += `\n⚡ ${speed}`
      if (eta && eta !== "00:00") text += ` • ⌛ ${eta}`
    }

    return text
  }

  async itemCompleted(success = true) {
    if (success) this.completed++
    else this.failed++
  }

  async finish() {
    if (this.lastProgressMessageId) {
      try {
        await this.sock.sendMessage(this.remoteJid, { delete: this.lastProgressMessageId })
      } catch (error) {
        // Ignore deletion errors
      }
    }

    const elapsed = Math.floor((Date.now() - this.startTime) / 1000)
    const timeStr = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, "0")}`

    await this.sock.sendMessage(this.remoteJid, {
      text: `✅ Completed! ${this.completed}/${this.totalItems} • ⏱️ ${timeStr}${this.failed > 0 ? ` • ❌ ${this.failed} failed` : ""}`,
    })
  }
}

// Global performance manager instance
export const performanceManager = new PerformanceManager()
