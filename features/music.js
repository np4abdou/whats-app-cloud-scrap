import fs from "fs"
import path from "path"
import fetch from "node-fetch"
import sanitize from "sanitize-filename"
import { spawn } from "child_process"
import { BASE_DIR, FILES_DIR, YOUTUBE_API_KEY } from "./constants.js"
import { downloadImage, formatDuration, formatNumber, getFileSize } from "./utils.js"
import { performanceManager } from "./performance.js"

// Music downloads directory
const MUSIC_DOWNLOAD_DIR = path.join(BASE_DIR, "downloads")

// Optimized HTTP client
const httpAgent = new (await import("http")).Agent({
  keepAlive: true,
  maxSockets: 15,
  timeout: 30000,
})

const httpsAgent = new (await import("https")).Agent({
  keepAlive: true,
  maxSockets: 15,
  timeout: 30000,
})

async function optimizedFetch(url, options = {}) {
  const isHttps = url.startsWith("https")
  return fetch(url, {
    ...options,
    agent: isHttps ? httpsAgent : httpAgent,
    timeout: 15000,
  })
}

// Ensure music download directory exists
export function ensureMusicDirectory() {
  if (!fs.existsSync(MUSIC_DOWNLOAD_DIR)) {
    fs.mkdirSync(MUSIC_DOWNLOAD_DIR, { recursive: true })
  }
}

// Parse music search command (unchanged)
export function parseMusicCommand(commandParts) {
  const fullCommand = commandParts.slice(1).join(" ")

  const dashMatch = fullCommand.match(/^(.+?)\s+-(\d+)$/)
  if (dashMatch) {
    return {
      query: dashMatch[1].replace(/^["']|["']$/g, "").trim(),
      maxResults: Number.parseInt(dashMatch[2]),
    }
  }

  const quotedMatch = fullCommand.match(/^["'](.+?)["']\s+(\d+)$/)
  if (quotedMatch) {
    return {
      query: quotedMatch[1].trim(),
      maxResults: Number.parseInt(quotedMatch[2]),
    }
  }

  const parts = fullCommand.split(/\s+/)
  const lastPart = parts[parts.length - 1]
  if (/^\d+$/.test(lastPart) && parts.length > 1) {
    return {
      query: parts
        .slice(0, -1)
        .join(" ")
        .replace(/^["']|["']$/g, "")
        .trim(),
      maxResults: Number.parseInt(lastPart),
    }
  }

  return {
    query: fullCommand.replace(/^["']|["']$/g, "").trim(),
    maxResults: 5,
  }
}

// Optimized YouTube music search
export async function searchYouTubeMusic(query, maxResults = 5) {
  try {
    const musicQuery = `${query} music audio song`

    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(musicQuery)}&maxResults=${maxResults}&order=relevance&videoCategoryId=10&key=${YOUTUBE_API_KEY}`

    const searchResponse = await optimizedFetch(searchUrl)
    const data = await searchResponse.json()

    if (!searchResponse.ok) {
      throw new Error(data.error?.message || "YouTube API request failed")
    }
    if (!data.items || data.items.length === 0) {
      return { success: false, error: "No music found for this search query" }
    }

    const videoIds = data.items.map((item) => item.id.videoId).join(",")
    const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${videoIds}&key=${YOUTUBE_API_KEY}`

    const statsResponse = await optimizedFetch(statsUrl)
    const statsData = await statsResponse.json()

    if (!statsResponse.ok) {
      throw new Error(statsData.error?.message || "Failed to get video statistics")
    }

    const music = data.items.map((item) => {
      const stats = statsData.items.find((stat) => stat.id === item.id.videoId)
      return {
        id: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail:
          item.snippet.thumbnails.high?.url ||
          item.snippet.thumbnails.medium?.url ||
          item.snippet.thumbnails.default?.url,
        channelTitle: item.snippet.channelTitle,
        publishedAt: item.snippet.publishedAt,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        views: stats?.statistics?.viewCount || "N/A",
        likes: stats?.statistics?.likeCount || "N/A",
        duration: stats?.contentDetails?.duration || "N/A",
      }
    })
    return { success: true, music }
  } catch (error) {
    console.error("YouTube music search failed:", error.message)
    return { success: false, error: error.message }
  }
}

// HYBRID APPROACH: Parallel download + Sequential send for music results
export async function sendMusicSearchResults(sock, remoteJid, music) {
  try {
    await sock.sendMessage(remoteJid, {
      text: `🎵 Found ${music.length} music tracks:\n\n📝 Reply with number to download\nExample: 1 or 2`,
    })

    // Prepare all music data and download images in parallel
    const musicPromises = music.map(async (track, i) => {
      const publishDate = new Date(track.publishedAt).toLocaleDateString()
      const duration = formatDuration(track.duration)
      const views = formatNumber(track.views)
      const likes = formatNumber(track.likes)

      const musicText = `*${i + 1}. ${track.title}*\n\n🎤 ${track.channelTitle}\n👀 ${views} | 👍 ${likes}\n⏱️ ${duration} | 📅 ${publishDate}`

      // Download image in parallel
      let thumbnailBuffer = null
      try {
        thumbnailBuffer = await downloadImage(track.thumbnail)
      } catch (error) {
        // Image download failed, will send text only
      }

      return {
        index: i,
        musicText,
        thumbnailBuffer,
      }
    })

    // Wait for all downloads to complete
    const musicData = await Promise.all(musicPromises)

    // Sort by index to maintain order
    musicData.sort((a, b) => a.index - b.index)

    // Send messages sequentially but with pre-downloaded data
    for (const data of musicData) {
      try {
        if (data.thumbnailBuffer) {
          await sock.sendMessage(remoteJid, {
            image: data.thumbnailBuffer,
            caption: data.musicText,
            mimetype: "image/jpeg",
          })
        } else {
          await sock.sendMessage(remoteJid, { text: data.musicText })
        }
      } catch (error) {
        await sock.sendMessage(remoteJid, { text: data.musicText })
      }

      // Minimal delay for WhatsApp ordering
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const instructions = `✅ All ${music.length} tracks loaded!\n\n🎵 Reply with track number to download as MP3\nExample: 1 (downloads first track)\n\n🎧 Features:\n• High-quality MP3 (320kbps)\n• Embedded album art\n• Metadata included\n• Auto-sent after download`

    await sock.sendMessage(remoteJid, { text: instructions })
  } catch (error) {
    console.error("Error sending music search results:", error)
    await sock.sendMessage(remoteJid, { text: "❌ Error displaying music results." })
  }
}

// Optimized music progress parsing
export function parseMusicProgress(line, progressTracker) {
  try {
    if (line.includes("[download]") && line.includes("%")) {
      if (line.includes("fragment")) {
        return
      }

      const percentMatch = line.match(/(\d+\.?\d*)%/)
      if (percentMatch) {
        const progress = Number.parseFloat(percentMatch[1])

        if (progress >= 100 && progressTracker.progressData.progress >= 100) {
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

        const elapsed_seconds = Math.floor((Date.now() - progressTracker.startTime) / 1000)
        const minutes = Math.floor(elapsed_seconds / 60)
        const seconds = elapsed_seconds % 60
        const time_elapsed = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`

        if (total_size && progress > progressTracker.progressData.progress) {
          progressTracker.updateProgress({
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

    if (line.includes("[ffmpeg]") && line.includes("Destination:")) {
      progressTracker.updateProgress({
        progress: 95,
        total_size: "Converting...",
        downloaded_size: "",
        speed: "",
        eta: "Almost done",
        time_elapsed: "",
      })
    }
  } catch (error) {
    console.log("Music progress parsing error:", error.message)
  }
}

// Optimized music download
export async function downloadYouTubeMusic(musicUrl, progressTracker = null) {
  let musicInfo = null
  const cookiePath = path.join(BASE_DIR, "youtube_cookies.txt")
  const hasCookies = fs.existsSync(cookiePath)

  ensureMusicDirectory()

  try {
    const infoArgs = [musicUrl, "--dump-single-json", "--no-warnings"]

    if (hasCookies) {
      infoArgs.push("--cookies", cookiePath)
    }

    const { spawn: spawnSync } = await import("child_process")
    const infoProcess = spawnSync("yt-dlp", infoArgs, { stdio: ["pipe", "pipe", "pipe"] })

    let infoOutput = ""
    infoProcess.stdout.on("data", (data) => {
      infoOutput += data.toString()
    })

    await new Promise((resolve, reject) => {
      infoProcess.on("close", (code) => {
        if (code === 0) {
          try {
            musicInfo = JSON.parse(infoOutput)
            resolve()
          } catch (error) {
            reject(new Error("Failed to parse video info"))
          }
        } else {
          reject(new Error(`Failed to get video info, exit code: ${code}`))
        }
      })
    })

    const title = sanitize(musicInfo.title || `music_${Date.now()}`)
    const uploader = sanitize(musicInfo.uploader || "Unknown Artist")

    const ytdlpArgs = [
      musicUrl,
      "--extractor-args",
      "generic:impersonate",
      "--no-mtime",
      "--retries",
      "3",
      "--fragment-retries",
      "3",
      "--retry-sleep",
      "3",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "--embed-thumbnail",
      "--add-metadata",
      "--metadata-from-title",
      "%(artist)s - %(title)s",
      "-P",
      MUSIC_DOWNLOAD_DIR,
      "--output",
      "%(title)s.%(ext)s",
      "--no-warnings",
      "--newline",
    ]

    if (hasCookies) {
      ytdlpArgs.push("--cookies", cookiePath)
    }

    const ytdlpProcess = spawn("yt-dlp", ytdlpArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    })

    let lastProgressUpdate = 0
    let downloadCompleted = false

    return new Promise((resolve, reject) => {
      ytdlpProcess.stdout.on("data", (data) => {
        const output = data.toString()
        const lines = output.split("\n")

        for (const line of lines) {
          if (line.trim() && progressTracker && !downloadCompleted) {
            const now = Date.now()
            if (now - lastProgressUpdate >= 2000 || line.includes("[download] 100%")) {
              parseMusicProgress(line, progressTracker)
              lastProgressUpdate = now

              if (line.includes("[download] 100%") && !line.includes("fragment")) {
                downloadCompleted = true
              }
            }
          }
        }
      })

      ytdlpProcess.stderr.on("data", (data) => {
        const output = data.toString()
        const lines = output.split("\n")

        for (const line of lines) {
          if (line.trim() && progressTracker && !downloadCompleted) {
            const now = Date.now()
            if (now - lastProgressUpdate >= 2000 || line.includes("[download] 100%")) {
              parseMusicProgress(line, progressTracker)
              lastProgressUpdate = now

              if (line.includes("[download] 100%") && !line.includes("fragment")) {
                downloadCompleted = true
              }
            }
          }
        }
      })

      ytdlpProcess.on("close", (code) => {
        if (code === 0) {
          const possibleFilenames = [`${title}.mp3`, `${musicInfo.title}.mp3`]

          let downloadedPath = null
          for (const filename of possibleFilenames) {
            const testPath = path.join(MUSIC_DOWNLOAD_DIR, filename)
            if (fs.existsSync(testPath)) {
              downloadedPath = testPath
              break
            }
          }

          if (!downloadedPath) {
            try {
              const files = fs.readdirSync(MUSIC_DOWNLOAD_DIR)
              const mp3Files = files.filter((file) => file.endsWith(".mp3"))

              if (mp3Files.length > 0) {
                let newestFile = null
                let newestTime = 0

                for (const file of mp3Files) {
                  const filePath = path.join(MUSIC_DOWNLOAD_DIR, file)
                  const stats = fs.statSync(filePath)
                  if (stats.mtime.getTime() > newestTime) {
                    newestTime = stats.mtime.getTime()
                    newestFile = filePath
                  }
                }

                downloadedPath = newestFile
              }
            } catch (error) {
              console.error("Error finding downloaded file:", error)
            }
          }

          if (!downloadedPath || !fs.existsSync(downloadedPath)) {
            reject(new Error(`MP3 file not found after download`))
            return
          }

          const finalFilename = path.basename(downloadedPath)
          const finalPath = path.join(FILES_DIR, finalFilename)

          fs.copyFileSync(downloadedPath, finalPath)

          resolve({
            success: true,
            filename: finalFilename,
            tempPath: downloadedPath,
            finalPath: finalPath,
            title: title,
            artist: uploader,
            originalTitle: musicInfo.title,
          })
        } else {
          reject(new Error(`yt-dlp process exited with code ${code}`))
        }
      })

      ytdlpProcess.on("error", (error) => {
        reject(error)
      })
    })
  } catch (err) {
    console.error("Music download failed:", err.message || err)
    return {
      success: false,
      error: err.message || "Download failed",
      title: musicInfo?.title || "Unknown Track",
    }
  }
}

// Optimized download and send music
export async function downloadAndSendMusic(sock, remoteJid, music) {
  try {
    await sock.sendPresenceUpdate("composing", remoteJid)

    const progressTracker = performanceManager.createOptimizedProgressTracker(sock, remoteJid, 1, "music")
    await progressTracker.start()

    const result = await downloadYouTubeMusic(music.url, progressTracker)

    await progressTracker.itemCompleted(result.success)
    await progressTracker.finish()

    if (result.success) {
      const fileSize = getFileSize(result.finalPath)

      // Send completion message and audio file concurrently
      const [, audioResult] = await Promise.all([
        sock.sendMessage(remoteJid, {
          text: `✅ Music download completed!\n🎵 ${result.filename}\n📊 Size: ${fileSize}\n🎤 Artist: ${result.artist}\n\n📤 Sending MP3...`,
        }),
        sock.sendMessage(remoteJid, {
          audio: { url: result.finalPath },
          fileName: result.filename,
          mimetype: "audio/mpeg",
          ptt: false,
          caption: `🎵 ${result.originalTitle}\n\n🎤 ${result.artist}\n📊 Size: ${fileSize}\n🎧 High Quality MP3 with metadata`,
        }),
      ])

      // Clean up temp file
      if (result.tempPath && fs.existsSync(result.tempPath)) {
        try {
          fs.unlinkSync(result.tempPath)
        } catch (error) {
          console.log("Could not clean temp music file:", error.message)
        }
      }

      await sock.sendMessage(remoteJid, {
        text: `✅ Music sent successfully!\n💾 File saved permanently\n🎧 Enjoy your music!`,
      })
    } else {
      await sock.sendMessage(remoteJid, {
        text: `❌ Music download failed\n🔴 Error: ${result.error}`,
      })
    }
    await sock.sendPresenceUpdate("available", remoteJid)
  } catch (error) {
    console.error("Error in downloadAndSendMusic:", error)
    await sock.sendMessage(remoteJid, { text: `❌ Download error: ${error.message}` })
    await sock.sendPresenceUpdate("available", remoteJid)
  }
}

// Handle music selection (unchanged)
export async function handleMusicSelection(sock, remoteJid, selection, userStates) {
  const userState = userStates.get(remoteJid)

  if (!userState || userState.state !== "music_search_results") {
    await sock.sendMessage(remoteJid, { text: "❌ No music search results found. Use /music command first." })
    return
  }

  const musicIndex = Number.parseInt(selection.trim()) - 1

  if (isNaN(musicIndex) || musicIndex < 0 || musicIndex >= userState.searchResults.length) {
    await sock.sendMessage(remoteJid, { text: `❌ Invalid music number. Choose 1-${userState.searchResults.length}` })
    return
  }

  const music = userState.searchResults[musicIndex]
  await downloadAndSendMusic(sock, remoteJid, music)

  userStates.delete(remoteJid)
}

// Optimized music command handler
export async function handleMusicCommand(sock, remoteJid, commandParts, userStates) {
  try {
    const parsed = parseMusicCommand(commandParts)

    if (!parsed.query) {
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
      return
    }

    await sock.sendPresenceUpdate("composing", remoteJid)
    await sock.sendMessage(remoteJid, {
      text: `🔍 Searching music: "${parsed.query}" (${parsed.maxResults} results)...`,
    })

    const searchResult = await searchYouTubeMusic(parsed.query, parsed.maxResults)

    if (searchResult.success && searchResult.music.length > 0) {
      userStates.set(remoteJid, {
        state: "music_search_results",
        searchResults: searchResult.music,
      })
      await sendMusicSearchResults(sock, remoteJid, searchResult.music)
    } else {
      await sock.sendMessage(remoteJid, {
        text: `❌ Music Search Failed: ${searchResult.error || "No music found."}`,
      })
    }
    await sock.sendPresenceUpdate("available", remoteJid)
  } catch (error) {
    console.error("Music search error:", error)
    await sock.sendMessage(remoteJid, { text: `❌ Search failed: ${error.message}` })
    await sock.sendPresenceUpdate("available", remoteJid)
  }
}
