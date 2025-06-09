import fs from "fs"
import path from "path"
import { PROGRESS_FILE, ANIME_DOWNLOAD_DIR, BASE_DIR } from "./constants.js"
import { getWorkspaceFiles } from "./utils.js"
import { getStorageInfo, cleanupTempFiles, savedChats } from "./storage.js"
import { sendFileList, handleFileUpload, handleFileDelete } from "./files.js"
import { parseYouTubeCommand, searchYouTubeVideos, sendVideoSearchResults } from "./youtube.js"
import { handleAnimeCommand } from "./anime.js"
import { activeDownloads } from "./progress.js"
import { handlePinterestCommand } from "./pinterest.js"
import { parseYouTubeChannelCommand, searchYouTubeChannels, sendChannelSearchResults } from "./youtube_channels.js"
import { handleMusicCommand } from "./music.js"
import { performanceManager } from "./performance.js"

// Safety functions for bot management
export async function restartBot() {
  console.log("🔄 Bot restart requested...")

  activeDownloads.clear()

  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      fs.unlinkSync(PROGRESS_FILE)
    }
  } catch (error) {
    console.log("Could not clean progress file:", error.message)
  }

  console.log("🔄 Terminating current process...")
  process.exit(0)
}

export async function stopBot() {
  console.log("🛑 Bot stop requested...")

  activeDownloads.clear()

  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      fs.unlinkSync(PROGRESS_FILE)
    }
  } catch (error) {
    console.log("Could not clean progress file:", error.message)
  }

  console.log("🛑 Stopping bot...")
  process.exit(1)
}

// Optimized welcome message
export async function sendWelcomeMessage(sock, remoteJid) {
  const welcomeText = `🤖 *Welcome to Enhanced WhatsApp Bot!*

✨ *I can help you with:*
• 📁 File sharing and management
• 🎥 YouTube video downloads  
• 🎌 Enhanced anime downloads with automation
• 🎵 High-quality music downloads

*🚀 Enhanced Features:*
• Real-time progress tracking
• Automatic file sending
• Episode range support
• File size display

*Quick Commands:*
• */help* - Show all commands
• */files* - Browse files
• */ys <query>* - Search YouTube
• */yc <query>* - Search YouTube channels
• */music <query>* - Search and download music
• */img <query>* - Search Pinterest images
• */anime <query>* - Search anime

📝 *Type /help for detailed instructions!*`

  try {
    await sock.sendMessage(remoteJid, { text: welcomeText })
  } catch (error) {
    console.error("Error sending welcome message:", error)
  }
}

// Optimized broadcast with parallel processing
export async function broadcastWelcomeMessage(sock, force = false) {
  if (!force && savedChats.size === 0) {
    console.log("📢 No saved chats to broadcast to")
    return
  }

  const welcomeText = `🤖 *Enhanced WhatsApp Bot Online!*

✨ *Available Commands:*
• */help* - Show all commands
• */files* - Browse files
• */upload <number>* - Send file
• */delete <number>* - Delete file
• */ys <query> -<number>* - Search YouTube
• */yc <query> -<number>* - Search YouTube channels
• */music <query> <number>* - Search and download music
• */img <query> <number>* - Search Pinterest images
• */anime <query>* - Interactive anime downloads
• */anime <name> <episode> <quality>* - Automated download
• */anime <name> <start-end> <quality>* - Range download
• */storage* - Check storage
• */cleanup* - Clean temp files
• */setcookies* - Set YouTube cookies
• */restart* - Restart bot
• */stop* - Stop bot

*🚀 New Features:*
• Real-time progress tracking
• Automatic file sending
• Episode range support (1-25)
• High-quality music downloads
• Optimized performance

*Examples:*
• */anime "one piece" 124 1080* - Download episode 124
• */music believer* - Download "Believer" as MP3`

  console.log(`📢 Broadcasting to ${savedChats.size} chats...`)

  // Convert to array for batch processing
  const chatArray = Array.from(savedChats)
  const messages = chatArray.map((jid) => ({
    remoteJid: jid,
    content: { text: welcomeText },
  }))

  try {
    const results = await performanceManager.sendMessagesBatch(sock, messages)
    const successCount = results.flat().filter((result) => result.status === "fulfilled" && result.value).length
    const failCount = results.flat().length - successCount

    console.log(`📢 Broadcast complete: ${successCount} sent, ${failCount} failed`)
  } catch (error) {
    console.error("Broadcast failed:", error)
  }
}

// New function to handle YouTube cookies
export async function handleSetCookies(sock, remoteJid, userStates) {
  try {
    await sock.sendMessage(remoteJid, {
      text:
        `🍪 *YouTube Cookies Setup*\n\n` +
        `Please send your YouTube cookies in Netscape format (plain text).\n\n` +
        `The cookies should start with:\n` +
        `\`\`\`\n# Netscape HTTP Cookie File\n...\`\`\`\n\n` +
        `Reply with "cancel" to cancel this operation.`,
    })

    userStates.set(remoteJid, {
      state: "waiting_for_cookies",
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error("Error in handleSetCookies:", error)
    await sock.sendMessage(remoteJid, { text: `❌ Error: ${error.message}` })
  }
}

// Function to save YouTube cookies
export async function saveCookies(sock, remoteJid, cookiesText, userStates) {
  try {
    if (cookiesText.toLowerCase() === "cancel") {
      userStates.delete(remoteJid)
      await sock.sendMessage(remoteJid, { text: "❌ Cookie setup cancelled." })
      return
    }

    // Basic validation - check if it looks like Netscape format
    if (!cookiesText.includes("# Netscape HTTP Cookie File") && !cookiesText.includes(".youtube.com")) {
      await sock.sendMessage(remoteJid, {
        text:
          `❌ Invalid cookie format. Cookies should be in Netscape format and contain YouTube domains.\n\n` +
          `Please try again or type "cancel" to cancel.`,
      })
      return
    }

    const cookiesPath = path.join(BASE_DIR, "youtube_cookies.txt")

    // Create a backup of the existing cookies file if it exists
    if (fs.existsSync(cookiesPath)) {
      const backupPath = path.join(BASE_DIR, `youtube_cookies_backup_${Date.now()}.txt`)
      fs.copyFileSync(cookiesPath, backupPath)
      console.log(`Created backup of cookies at ${backupPath}`)
    }

    // Write the new cookies
    fs.writeFileSync(cookiesPath, cookiesText, "utf8")

    // Set file permissions to read/write for owner only (more secure)
    try {
      fs.chmodSync(cookiesPath, 0o600)
    } catch (error) {
      console.log("Could not set file permissions:", error.message)
    }

    userStates.delete(remoteJid)
    await sock.sendMessage(remoteJid, {
      text:
        `✅ YouTube cookies saved successfully!\n\n` +
        `🔒 The cookies file has been updated and secured.\n` +
        `🎬 You can now download age-restricted and private videos.\n\n` +
        `Note: The cookies will remain unchanged until you update them again.`,
    })
  } catch (error) {
    console.error("Error saving cookies:", error)
    await sock.sendMessage(remoteJid, { text: `❌ Error saving cookies: ${error.message}` })
    userStates.delete(remoteJid)
  }
}

// Optimized command handler
export async function handleCommand(sock, messageInfo, command, userStates) {
  const { remoteJid } = messageInfo
  const commandParts = command.split(" ")
  const mainCommand = commandParts[0].toLowerCase()

  switch (mainCommand) {
    case "/anime":
      if (commandParts.length < 2) {
        await sock.sendMessage(remoteJid, {
          text: `❌ Please provide an anime name.

*Usage:*
• */anime <name>* - Interactive search
• */anime <name> <episode> <quality>* - Auto download
• */anime <name> <start-end> <quality>* - Range download

*Examples:*
• */anime naruto* - Search Naruto
• */anime "one piece" 124 1080* - Download episode 124
• */anime "death note" 1-6 720* - Download episodes 1-6

*Quality options:* 480, 720, 1080`,
        })
        break
      }

      await handleAnimeCommand(sock, remoteJid, commandParts, userStates)
      break

    case "/files":
      const files = getWorkspaceFiles()
      if (files.length === 0) {
        await sock.sendMessage(remoteJid, { text: "📁 No files found in the files directory." })
        return
      }

      userStates.set(remoteJid, { state: "selecting_file", files: files })
      await sendFileList(sock, remoteJid, files)
      break

    case "/upload":
      if (commandParts.length < 2) {
        await sock.sendMessage(remoteJid, {
          text: "❌ Please specify file number.\n\n*Usage:* /upload <number>\n*Example:* /upload 1\n\n💡 Use /files first to see available files",
        })
        break
      }

      const uploadFileNumber = commandParts[1]
      await handleFileUpload(sock, messageInfo, uploadFileNumber, userStates)
      break

    case "/delete":
      if (commandParts.length < 2) {
        await sock.sendMessage(remoteJid, {
          text: `❌ Please specify file number(s).

*Usage:* 
• /delete <number> - Delete single file
• /delete <number>,<number> - Delete multiple files

*Examples:* 
• /delete 3 - Delete third file
• /delete 1,3,5 - Delete files 1, 3, and 5

💡 Use /files first to see available files`,
        })
        break
      }

      const deleteFileNumbers = commandParts[1]
      await handleFileDelete(sock, messageInfo, deleteFileNumbers, userStates)
      break

    case "/ys":
      if (commandParts.length < 2) {
        await sock.sendMessage(remoteJid, {
          text: `❌ Please provide a search query.

*Usage Examples:*
• /ys "dream manhunt" 5 - Search with quotes
• /ys minecraft -10 - Search with dash format
• /ys speedrun 3 - Simple search

📝 Format: /ys <query> -<number>
📝 Or: /ys "<query>" <number>`,
        })
        break
      }

      try {
        const { query, maxResults } = parseYouTubeCommand(commandParts)

        if (!query) {
          await sock.sendMessage(remoteJid, { text: "❌ Please provide a valid search query." })
          break
        }

        await sock.sendPresenceUpdate("composing", remoteJid)
        await sock.sendMessage(remoteJid, { text: `🔍 Searching: "${query}" (${maxResults} results)...` })

        const searchResult = await searchYouTubeVideos(query, maxResults)

        if (searchResult.success && searchResult.videos.length > 0) {
          userStates.set(remoteJid, {
            state: "video_search_results",
            searchResults: searchResult.videos,
          })
          await sendVideoSearchResults(sock, remoteJid, searchResult.videos)
        } else {
          await sock.sendMessage(remoteJid, {
            text: `❌ YouTube Search Failed: ${searchResult.error || "No videos found."}`,
          })
        }
        await sock.sendPresenceUpdate("available", remoteJid)
      } catch (error) {
        console.error("YouTube search error:", error)
        await sock.sendMessage(remoteJid, { text: `❌ Search failed: ${error.message}` })
        await sock.sendPresenceUpdate("available", remoteJid)
      }
      break

    case "/yc":
      if (commandParts.length < 2) {
        await sock.sendMessage(remoteJid, {
          text: `❌ Please provide a channel search query.

*Usage Examples:*
• /yc "MrBeast" 5 - Search for MrBeast channels
• /yc pewdiepie -10 - Search with dash format
• /yc "Kurzgesagt" 3 - Search with quotes

📝 Format: /yc <query> -<number>
📝 Or: /yc "<query>" <number>

💡 After finding channels, reply with number to see latest videos
Example: 1 (shows 10 latest videos) or 1 15 (shows 15 latest videos)`,
        })
        break
      }

      try {
        const { query, maxResults } = parseYouTubeChannelCommand(commandParts)

        if (!query) {
          await sock.sendMessage(remoteJid, { text: "❌ Please provide a valid search query." })
          break
        }

        await sock.sendPresenceUpdate("composing", remoteJid)
        await sock.sendMessage(remoteJid, { text: `🔍 Searching channels: "${query}" (${maxResults} results)...` })

        const searchResult = await searchYouTubeChannels(query, maxResults)

        if (searchResult.success && searchResult.channels.length > 0) {
          userStates.set(remoteJid, {
            state: "channel_search_results",
            searchResults: searchResult.channels,
          })
          await sendChannelSearchResults(sock, remoteJid, searchResult.channels)
        } else {
          await sock.sendMessage(remoteJid, {
            text: `❌ YouTube Channel Search Failed: ${searchResult.error || "No channels found."}`,
          })
        }
        await sock.sendPresenceUpdate("available", remoteJid)
      } catch (error) {
        console.error("YouTube channel search error:", error)
        await sock.sendMessage(remoteJid, { text: `❌ Search failed: ${error.message}` })
        await sock.sendPresenceUpdate("available", remoteJid)
      }
      break

    case "/music":
      if (commandParts.length < 2) {
        await sock.sendMessage(remoteJid, {
          text: `❌ Please provide a music search query.

*Usage:*
• */music <song name>* - Search for music (default 5 results)
• */music <song name> <number>* - Search with specific count

*Examples:*
• */music believer* - Search for "Believer"
• */music "imagine dragons" 3* - Search 3 Imagine Dragons songs
• */music sunrise 10* - Search 10 "Sunrise" tracks

*Features:*
🎵 High-quality MP3 (320kbps)
🖼️ Embedded album art
📝 Metadata included
📤 Auto-sent after download`,
        })
        break
      }

      await handleMusicCommand(sock, remoteJid, commandParts, userStates)
      break

    case "/img":
      if (commandParts.length < 2) {
        await sock.sendMessage(remoteJid, {
          text: `❌ Please provide a search query.

*Usage:*
• */img <query>* - Get 10 images (default)
• */img <query> <number>* - Get specific number of images

*Examples:*
• */img one piece* - Get 10 One Piece images
• */img naruto 20* - Get 20 Naruto images
• */img anime wallpaper 5* - Get 5 anime wallpapers

*Note:* Maximum 50 images per request`,
        })
        break
      }

      await handlePinterestCommand(sock, remoteJid, commandParts)
      break

    case "/restart":
      await sock.sendMessage(remoteJid, { text: "🔄 Restarting bot... All processes will be stopped and restarted." })
      await restartBot()
      break

    case "/stop":
      await sock.sendMessage(remoteJid, { text: "🛑 Stopping bot... Core bash terminal will be stopped." })
      await stopBot()
      break

    case "/setcookies":
      await handleSetCookies(sock, remoteJid, userStates)
      break

    case "/help":
      const helpText = `🤖 *Enhanced WhatsApp Bot Help*

*📋 Available Commands:*
• */files* - Browse files
• */upload <number>* - Send file by number
• */delete <number>* - Delete file by number
• */delete <number>,<number>* - Delete multiple files
• */ys <query> -<number>* - Search YouTube videos
• */yc <query> -<number>* - Search YouTube channels
• */music <query> <number>* - Search and download music as MP3
• */img <query> <number>* - Search Pinterest images
• */anime <query>* - Interactive anime downloads
• */anime <name> <episode> <quality>* - Automated download
• */anime <name> <start-end> <quality>* - Range download
• */storage* - Check storage usage
• */cleanup* - Clean temporary files
• */setcookies* - Set YouTube cookies manually
• */restart* - Restart bot (stops all processes)
• */stop* - Stop bot core
• */help* - Show this help

*🚀 Performance Features:*
• Parallel processing for faster results
• Optimized connection pooling
• Real-time progress tracking
• Automatic file sending after download
• Batch operations for multiple items
• Minimal delays for faster response
• Memory optimization
• Error handling optimization

*🖼️ Pinterest Examples:*
• */img one piece* - Get 10 One Piece images
• */img naruto 20* - Get 20 Naruto images
• */img anime wallpaper 5* - Get 5 anime wallpapers

*📺 YouTube Examples:*
• */ys minecraft 5* - Search 5 Minecraft videos
• */yc "MrBeast" 3* - Search 3 MrBeast channels
• After channel search: *1 15* - Get 15 latest videos from first channel

*🎵 Music Examples:*
• */music believer* - Search for "Believer"
• */music "imagine dragons" 3* - Search 3 Imagine Dragons songs
• */music sunrise 10* - Search 10 "Sunrise" tracks`

      await sock.sendMessage(remoteJid, { text: helpText })
      break

    case "/storage":
      try {
        const cookiesPath = path.join(BASE_DIR, "youtube_cookies.txt")
        const cookiesExist = fs.existsSync(cookiesPath)
        let cookiesInfo = "❌ Not found"

        if (cookiesExist) {
          try {
            const stats = fs.statSync(cookiesPath)
            const lastModified = new Date(stats.mtime).toLocaleString()
            cookiesInfo = `✅ Found (Last updated: ${lastModified})`
          } catch (error) {
            cookiesInfo = "✅ Found (Could not read details)"
          }
        }

        const storageInfo = getStorageInfo()
        const storageMessage =
          `📊 *Storage Information:*\n\n` +
          `📁 *Files Directory:* ${storageInfo.workspaceSize}\n` +
          `🗂️ *Files Count:* ${storageInfo.filesCount} files\n` +
          `🗑️ *Temp Directory:* ${storageInfo.tempSize}\n` +
          `🎌 *Anime Downloads:* ${storageInfo.animeSize}\n` +
          `🎵 *Music Downloads:* ${storageInfo.musicSize}\n` +
          `📍 *Anime Path:* ${ANIME_DOWNLOAD_DIR}\n` +
          `📍 *Music Path:* downloads/\n\n` +
          `🍪 *YouTube Cookies:* ${cookiesInfo}\n` +
          `💾 *Saved Chats:* ${storageInfo.savedChatsCount} chats\n` +
          `📊 *Active Downloads:* ${activeDownloads.size} sessions\n` +
          `⚡ *Performance:* Optimized with parallel processing\n\n` +
          `💡 Use /cleanup to free up temporary files\n` +
          `🔧 Use /restart if bot is stuck or lagging\n` +
          `🛑 Use /stop to stop core bash terminal`
        await sock.sendMessage(remoteJid, { text: storageMessage })
      } catch (error) {
        await sock.sendMessage(remoteJid, { text: `❌ Storage check failed: ${error.message}` })
      }
      break

    case "/cleanup":
      try {
        await sock.sendMessage(remoteJid, { text: "🧹 Starting cleanup..." })
        const tempFilesDeleted = await cleanupTempFiles()

        try {
          if (fs.existsSync(PROGRESS_FILE)) {
            fs.unlinkSync(PROGRESS_FILE)
          }
        } catch (error) {
          console.log("Could not clean progress file:", error.message)
        }

        await sock.sendMessage(remoteJid, {
          text: `✅ Cleanup completed!\n\n🗑️ Removed ${tempFilesDeleted} temporary files\n💾 Files directory preserved\n🎌 Anime downloads preserved\n🎵 Music downloads preserved\n📊 Progress tracking reset`,
        })
      } catch (error) {
        await sock.sendMessage(remoteJid, { text: `❌ Cleanup error: ${error.message}` })
      }
      break

    case "/broadcast":
      if (savedChats.size === 0) {
        await sock.sendMessage(remoteJid, { text: "📢 No saved chats to broadcast to." })
        break
      }

      await sock.sendMessage(remoteJid, {
        text: `📢 Starting optimized broadcast to ${savedChats.size} chats...`,
      })

      await broadcastWelcomeMessage(sock, true)

      await sock.sendMessage(remoteJid, {
        text: `✅ Broadcast completed!`,
      })
      break

    default:
      await sock.sendMessage(remoteJid, { text: "❓ Unknown command. Type /help for available commands." })
  }
}
