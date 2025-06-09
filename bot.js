// Enhanced WhatsApp bot with advanced automation and performance optimizations
import pkg from "@whiskeysockets/baileys"
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = pkg
import readline from "readline"
import fs from "fs"
import qrcode from "qrcode-terminal"
import pino from "pino"
import path from "path"
import { PROGRESS_FILE } from "./features/constants.js"

// Import our feature modules
import { ensureDirectories } from "./features/utils.js"
import { SESSION_DIR, TMP_DIR, DEFAULT_AUTO_REPLY } from "./features/constants.js"
import { loadSavedChats, addSavedChat } from "./features/storage.js"
import { startProgressMonitoring } from "./features/progress.js"
import { handleCommand, saveCookies } from "./features/commands.js"
import { handleVideoSelection, handleChannelSelection } from "./features/youtube.js"
import {
  handleAutomatedAnimeConfirmation,
  handleAnimeSelection,
  handleEpisodeSelection,
  handleQualitySelection,
} from "./features/anime.js"
import { handleFileSelection, confirmFileDelete } from "./features/files.js"
import { handleMusicSelection } from "./features/music.js"
import { performanceManager } from "./features/performance.js"

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

// Bot state management
const botRunning = true

// Optimized user state management with Map for better performance
const userStates = new Map()

// Force Node.js and Baileys to use custom tmp directory
process.env.TMPDIR = TMP_DIR

// Initialize directories
ensureDirectories()

// Enhanced QR Code display function
async function displayQRCode(qr) {
  console.log("\n" + "=".repeat(50))
  console.log("📱 SCAN QR CODE WITH WHATSAPP")
  console.log("=".repeat(50))

  try {
    console.log("\n🔲 QR Code:")
    qrcode.generate(qr, { small: true }, (qrString) => {
      console.log(qrString)
    })

    console.log("\n" + "=".repeat(50))
    console.log("📱 Open WhatsApp > Linked Devices > Link a Device")
    console.log("📷 Point your camera at the QR code above")
    console.log("=".repeat(50) + "\n")
  } catch (error) {
    console.log("⚠️ QR display method failed, showing text code:")
    console.log("\n📝 QR Code Text:")
    console.log(qr)
    console.log("\n💡 Install qrcode-terminal: npm install qrcode-terminal")
    console.log("\n" + "=".repeat(50))
    console.log("📱 Open WhatsApp > Linked Devices > Link a Device")
    console.log("📷 Point your camera at the QR code above")
    console.log("=".repeat(50) + "\n")
  }
}

// Clear session if connection issues persist
function clearSession() {
  try {
    if (fs.existsSync(SESSION_DIR)) {
      const files = fs.readdirSync(SESSION_DIR)
      for (const file of files) {
        fs.unlinkSync(path.join(SESSION_DIR, file))
      }
      console.log("🗑️ Cleared session files - you'll need to scan QR code again")
    }
  } catch (error) {
    console.error("Error clearing session:", error)
  }
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)
  const { version, isLatest } = await fetchLatestBaileysVersion()
  console.log(`🔄 Using WA v${version.join(".")}, isLatest: ${isLatest}`)

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: state,
    msgRetryCounterMap: {},
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 10000,
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    // Performance optimizations
    maxMsgRetryCount: 3,
    retryRequestDelayMs: 250,
    fireInitQueries: true,
    emitOwnEvents: false,
  })

  let isFirstConnection = true

  // Optimized message handler with better performance
  const messagesUpsertHandler = async (m) => {
    if (!botRunning) return
    if (m.type !== "notify") return

    const message = m.messages[0]
    if (!message.message) return

    const remoteJid = message.key.remoteJid
    if (message.key.fromMe) return

    try {
      const messageText = message.message.conversation || message.message.extendedTextMessage?.text || ""

      // Early return for empty messages
      if (!messageText.trim()) return

      addSavedChat(remoteJid)

      const messageInfo = { remoteJid, message, messageText: messageText.trim() }

      // Handle commands with priority
      if (messageText.trim().startsWith("/")) {
        await performanceManager.throttleOperation(async () => {
          await handleCommand(sock, messageInfo, messageText.trim(), userStates)
        })
        return
      }

      // Handle user states with optimized pattern matching
      const userState = userStates.get(remoteJid)
      if (userState) {
        const trimmedText = messageText.trim()

        switch (userState.state) {
          case "selecting_file":
            if (/^\d+$/.test(trimmedText)) {
              await handleFileSelection(sock, messageInfo, trimmedText, userStates)
              return
            }
            if (trimmedText.toLowerCase() === "cancel") {
              userStates.delete(remoteJid)
              await sock.sendMessage(remoteJid, { text: "❌ File browser cancelled." })
              return
            }
            break

          case "confirming_delete":
            await confirmFileDelete(sock, messageInfo, trimmedText, userStates)
            return

          case "video_search_results":
            if (/^\d+\s+(480|720|1080)$/.test(trimmedText)) {
              await handleVideoSelection(sock, messageInfo, trimmedText, userStates)
              return
            }
            break

          case "channel_search_results":
            if (/^\d+(\s+\d+)?$/.test(trimmedText)) {
              await handleChannelSelection(sock, remoteJid, trimmedText, userStates)
              return
            }
            break

          case "channel_videos_results":
            if (/^\d+\s+(480|720|1080)$/.test(trimmedText)) {
              await handleVideoSelection(sock, messageInfo, trimmedText, userStates)
              return
            }
            break

          case "anime_selection":
            if (/^\d+$/.test(trimmedText)) {
              await handleAnimeSelection(sock, remoteJid, trimmedText, userStates)
              return
            }
            break

          case "episode_selection":
            if (/^\d+$/.test(trimmedText) || /^\d+-\d+$/.test(trimmedText)) {
              await handleEpisodeSelection(sock, remoteJid, trimmedText, userStates)
              return
            }
            break

          case "quality_selection":
            if (/^\d+$/.test(trimmedText)) {
              await handleQualitySelection(sock, remoteJid, trimmedText, userStates)
              return
            }
            break

          case "automated_anime_confirmation":
            await handleAutomatedAnimeConfirmation(sock, remoteJid, trimmedText, userStates)
            return

          case "music_search_results":
            if (/^\d+$/.test(trimmedText)) {
              await handleMusicSelection(sock, remoteJid, trimmedText, userStates)
              return
            }
            break

          case "waiting_for_cookies":
            // Handle cookie text submission
            await saveCookies(sock, remoteJid, trimmedText, userStates)
            return
        }
      }

      // Send default auto-reply message only for non-empty messages
      if (messageText.trim().length > 0) {
        await sock.sendMessage(remoteJid, { text: DEFAULT_AUTO_REPLY })
      }
    } catch (error) {
      console.error("Error processing message:", error)
    }
  }

  const connectionUpdateHandler = async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      await displayQRCode(qr)
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut && botRunning
      console.log(`📱 Connection closed. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`)

      if (shouldReconnect) {
        console.log("⏳ Waiting 3 seconds before reconnecting...")
        setTimeout(() => {
          if (botRunning) {
            connectToWhatsApp()
          }
        }, 3000) // Reduced from 5 seconds to 3 seconds
      }
    } else if (connection === "open") {
      console.log("\n✅ Enhanced WhatsApp Bot with Performance Optimization is ready!")
      console.log("🚀 Features: Parallel processing, optimized connections, real-time progress")
      console.log("📁 Files preserved in /files, anime downloads in /home/container/new/files")
      console.log("🎵 Music downloads in /downloads with high-quality MP3")
      console.log("⚡ Performance: Connection pooling, batch operations, minimal delays")
      console.log("🔧 Safety: /restart and /stop commands available")

      startProgressMonitoring()

      if (isFirstConnection) {
        isFirstConnection = false
        console.log("🎉 Bot is now ready to receive commands with optimized performance!")
      }
    }
  }

  // Optimized event listeners
  sock.ev.on("messages.upsert", messagesUpsertHandler)
  sock.ev.on("connection.update", connectionUpdateHandler)
  sock.ev.on("creds.update", saveCreds)

  return sock
}

async function main() {
  console.log("🚀 Starting Enhanced WhatsApp Bot with Performance Optimization...")
  console.log("⚡ Features: Parallel processing, connection pooling, batch operations")
  console.log("🎵 Music downloads: High-quality MP3 with metadata and album art")
  console.log("📺 YouTube: Optimized video and channel search with concurrent processing")
  console.log("🖼️ Pinterest: Batch image processing with connection reuse")
  console.log("🎌 Anime: Enhanced downloads with real-time progress tracking")
  console.log("🔧 Safety commands: /restart and /stop available")
  console.log("📊 Progress file: /tmp/download_progress.json")

  loadSavedChats()

  try {
    const sock = await connectToWhatsApp()

    // Optimized shutdown handler
    process.on("SIGINT", async () => {
      console.log("\n🛑 Shutting down bot...")

      try {
        if (fs.existsSync(PROGRESS_FILE)) {
          fs.unlinkSync(PROGRESS_FILE)
        }
      } catch (error) {
        console.log("Could not clean progress file on exit:", error.message)
      }

      rl.close()
      process.exit(0)
    })

    // Handle uncaught exceptions gracefully
    process.on("uncaughtException", (error) => {
      console.error("Uncaught Exception:", error)
      // Don't exit, just log the error
    })

    process.on("unhandledRejection", (reason, promise) => {
      console.error("Unhandled Rejection at:", promise, "reason:", reason)
      // Don't exit, just log the error
    })
  } catch (error) {
    console.error("❌ Failed to start bot:", error)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("❌ Unhandled error:", err)
  process.exit(1)
})
