import fs from "fs"
import path from "path"
import youtubedl from "youtube-dl-exec"
import sanitize from "sanitize-filename"
import fetch from "node-fetch"
import { spawn } from "child_process"
import { BASE_DIR, FILES_DIR, TMP_DIR, VIDEO_QUALITIES, YOUTUBE_API_KEY } from "./constants.js"
import { downloadImage, formatDuration, formatNumber, getMimetype, getFileSize } from "./utils.js"
import { performanceManager } from "./performance.js"

// Optimized HTTP client with connection pooling
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

// Enhanced fetch with connection pooling
async function optimizedFetch(url, options = {}) {
  const isHttps = url.startsWith("https")
  return fetch(url, {
    ...options,
    agent: isHttps ? httpsAgent : httpAgent,
    timeout: 15000,
  })
}

// Parse YouTube search command (unchanged)
export function parseYouTubeCommand(commandParts) {
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

// Parse YouTube channel command (unchanged)
export function parseYouTubeChannelCommand(commandParts) {
  return parseYouTubeCommand(commandParts)
}

// Optimized YouTube API functions with parallel processing
export async function searchYouTubeVideos(query, maxResults = 5) {
  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(query)}&maxResults=${maxResults}&order=relevance&key=${YOUTUBE_API_KEY}`

    const [searchResponse, statsResponse] = await Promise.all([
      optimizedFetch(searchUrl),
      // Pre-fetch stats will be done after we get video IDs
      Promise.resolve(null),
    ])

    const data = await searchResponse.json()

    if (!searchResponse.ok) {
      throw new Error(data.error?.message || "YouTube API request failed")
    }
    if (!data.items || data.items.length === 0) {
      return { success: false, error: "No videos found for this search query" }
    }

    const videoIds = data.items.map((item) => item.id.videoId).join(",")
    const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${videoIds}&key=${YOUTUBE_API_KEY}`

    const statsResponseActual = await optimizedFetch(statsUrl)
    const statsData = await statsResponseActual.json()

    if (!statsResponseActual.ok) {
      throw new Error(statsData.error?.message || "Failed to get video statistics")
    }

    const videos = data.items.map((item) => {
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
    return { success: true, videos }
  } catch (error) {
    console.error("Youtube search failed:", error.message)
    return { success: false, error: error.message }
  }
}

// Optimized channel search with parallel processing
export async function searchYouTubeChannels(query, maxResults = 5) {
  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(query)}&maxResults=${maxResults}&order=relevance&key=${YOUTUBE_API_KEY}`

    const searchResponse = await optimizedFetch(searchUrl)
    const data = await searchResponse.json()

    if (!searchResponse.ok) {
      throw new Error(data.error?.message || "YouTube API request failed")
    }
    if (!data.items || data.items.length === 0) {
      return { success: false, error: "No channels found for this search query" }
    }

    const channelIds = data.items.map((item) => item.id.channelId).join(",")
    const statsUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet,brandingSettings&id=${channelIds}&key=${YOUTUBE_API_KEY}`

    const statsResponse = await optimizedFetch(statsUrl)
    const statsData = await statsResponse.json()

    if (!statsResponse.ok) {
      throw new Error(statsData.error?.message || "Failed to get channel statistics")
    }

    const channels = data.items.map((item) => {
      const stats = statsData.items.find((stat) => stat.id === item.id.channelId)
      return {
        id: item.id.channelId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail:
          item.snippet.thumbnails.high?.url ||
          item.snippet.thumbnails.medium?.url ||
          item.snippet.thumbnails.default?.url,
        customUrl: stats?.snippet?.customUrl || "",
        publishedAt: item.snippet.publishedAt,
        url: `https://www.youtube.com/channel/${item.id.channelId}`,
        subscriberCount: stats?.statistics?.subscriberCount || "N/A",
        videoCount: stats?.statistics?.videoCount || "N/A",
        viewCount: stats?.statistics?.viewCount || "N/A",
        country: stats?.snippet?.country || "N/A",
        bannerImage: stats?.brandingSettings?.image?.bannerExternalUrl || null,
      }
    })
    return { success: true, channels }
  } catch (error) {
    console.error("YouTube channel search failed:", error.message)
    return { success: false, error: error.message }
  }
}

// Get latest videos from a channel with optimization
export async function getChannelLatestVideos(channelId, maxResults = 10) {
  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&order=date&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`

    const searchResponse = await optimizedFetch(searchUrl)
    const data = await searchResponse.json()

    if (!searchResponse.ok) {
      throw new Error(data.error?.message || "YouTube API request failed")
    }
    if (!data.items || data.items.length === 0) {
      return { success: false, error: "No videos found for this channel" }
    }

    const videoIds = data.items.map((item) => item.id.videoId).join(",")
    const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${videoIds}&key=${YOUTUBE_API_KEY}`

    const statsResponse = await optimizedFetch(statsUrl)
    const statsData = await statsResponse.json()

    if (!statsResponse.ok) {
      throw new Error(statsData.error?.message || "Failed to get video statistics")
    }

    const videos = data.items.map((item) => {
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
    return { success: true, videos }
  } catch (error) {
    console.error("Channel videos fetch failed:", error.message)
    return { success: false, error: error.message }
  }
}

// HYBRID APPROACH: Parallel download + Sequential send for speed AND order
export async function sendVideoSearchResults(sock, remoteJid, videos) {
  try {
    // Send initial message
    await sock.sendMessage(remoteJid, {
      text: `🔍 Found ${videos.length} videos:\n\n📝 Reply: <number> <quality>\nExample: 2 1080 or 1 480`,
    })

    // Prepare all video data and download images in parallel
    const videoPromises = videos.map(async (video, i) => {
      const publishDate = new Date(video.publishedAt).toLocaleDateString()
      const duration = formatDuration(video.duration)
      const views = formatNumber(video.views)
      const likes = formatNumber(video.likes)

      const videoText = `*${i + 1}. ${video.title}*\n\n📺 ${video.channelTitle}\n👀 ${views} | 👍 ${likes}\n⏱️ ${duration} | 📅 ${publishDate}`

      // Download image in parallel
      let thumbnailBuffer = null
      try {
        thumbnailBuffer = await downloadImage(video.thumbnail)
      } catch (error) {
        // Image download failed, will send text only
      }

      return {
        index: i,
        videoText,
        thumbnailBuffer,
      }
    })

    // Wait for all downloads to complete
    const videoData = await Promise.all(videoPromises)

    // Sort by index to maintain order
    videoData.sort((a, b) => a.index - b.index)

    // Send messages sequentially but with pre-downloaded data
    for (const data of videoData) {
      try {
        if (data.thumbnailBuffer) {
          await sock.sendMessage(remoteJid, {
            image: data.thumbnailBuffer,
            caption: data.videoText,
            mimetype: "image/jpeg",
          })
        } else {
          await sock.sendMessage(remoteJid, { text: data.videoText })
        }
      } catch (error) {
        await sock.sendMessage(remoteJid, { text: data.videoText })
      }

      // Minimal delay for WhatsApp ordering
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const qualityInstructions = `✅ All ${videos.length} videos loaded!\n\n🎬 Quality Options:\n🔹 480 - 480p SD\n🔹 720 - 720p HD\n🔹 1080 - 1080p FHD\n\n📝 Format: <video_number> <quality>\nExamples: 1 1080, 3 720, 5 480`

    await sock.sendMessage(remoteJid, { text: qualityInstructions })
  } catch (error) {
    console.error("Error sending video search results:", error)
    await sock.sendMessage(remoteJid, { text: "❌ Error displaying video results." })
  }
}

// HYBRID APPROACH: Parallel download + Sequential send for channels
export async function sendChannelSearchResults(sock, remoteJid, channels) {
  try {
    await sock.sendMessage(remoteJid, {
      text: `📺 Found ${channels.length} channels:\n\n📝 Reply with number to see latest videos\nExample: 1 or 2`,
    })

    // Prepare all channel data and download images in parallel
    const channelPromises = channels.map(async (channel, i) => {
      const publishDate = new Date(channel.publishedAt).toLocaleDateString()
      const subscribers = formatNumber(channel.subscriberCount)
      const videoCount = formatNumber(channel.videoCount)
      const totalViews = formatNumber(channel.viewCount)

      let channelText = `*${i + 1}. ${channel.title}*\n\n`
      channelText += `👥 ${subscribers} subscribers\n`
      channelText += `🎥 ${videoCount} videos\n`
      channelText += `👀 ${totalViews} total views\n`
      channelText += `📅 Created: ${publishDate}\n`

      if (channel.country && channel.country !== "N/A") {
        channelText += `🌍 ${channel.country}\n`
      }

      if (channel.customUrl) {
        channelText += `🔗 ${channel.customUrl}\n`
      }

      if (channel.description) {
        const shortDesc =
          channel.description.length > 100 ? channel.description.substring(0, 100) + "..." : channel.description
        channelText += `\n📝 ${shortDesc}`
      }

      // Download image in parallel
      let thumbnailBuffer = null
      try {
        thumbnailBuffer = await downloadImage(channel.thumbnail)
      } catch (error) {
        // Image download failed, will send text only
      }

      return {
        index: i,
        channelText,
        thumbnailBuffer,
      }
    })

    // Wait for all downloads to complete
    const channelData = await Promise.all(channelPromises)

    // Sort by index to maintain order
    channelData.sort((a, b) => a.index - b.index)

    // Send messages sequentially but with pre-downloaded data
    for (const data of channelData) {
      try {
        if (data.thumbnailBuffer) {
          await sock.sendMessage(remoteJid, {
            image: data.thumbnailBuffer,
            caption: data.channelText,
            mimetype: "image/jpeg",
          })
        } else {
          await sock.sendMessage(remoteJid, { text: data.channelText })
        }
      } catch (error) {
        await sock.sendMessage(remoteJid, { text: data.channelText })
      }

      // Minimal delay for WhatsApp ordering
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const instructions = `✅ All ${channels.length} channels loaded!\n\n📝 Reply with channel number to see latest videos\nExample: 1 (shows latest videos from first channel)\n\n💡 You can also specify how many videos: 1 10 (shows 10 latest videos)`

    await sock.sendMessage(remoteJid, { text: instructions })
  } catch (error) {
    console.error("Error sending channel search results:", error)
    await sock.sendMessage(remoteJid, { text: "❌ Error displaying channel results." })
  }
}

// HYBRID APPROACH: Parallel download + Sequential send for channel videos
export async function sendChannelLatestVideos(sock, remoteJid, videos, channelTitle, requestedCount) {
  try {
    await sock.sendMessage(remoteJid, {
      text: `🎥 Latest ${videos.length} videos from *${channelTitle}*:\n\n📝 Reply: <number> <quality> to download\nExample: 2 1080 or 1 480`,
    })

    // Prepare all video data and download images in parallel
    const videoPromises = videos.map(async (video, i) => {
      const publishDate = new Date(video.publishedAt).toLocaleDateString()
      const duration = formatDuration(video.duration)
      const views = formatNumber(video.views)
      const likes = formatNumber(video.likes)

      const videoText = `*${i + 1}. ${video.title}*\n\n📺 ${video.channelTitle}\n👀 ${views} | 👍 ${likes}\n⏱️ ${duration} | 📅 ${publishDate}`

      // Download image in parallel
      let thumbnailBuffer = null
      try {
        thumbnailBuffer = await downloadImage(video.thumbnail)
      } catch (error) {
        // Image download failed, will send text only
      }

      return {
        index: i,
        videoText,
        thumbnailBuffer,
      }
    })

    // Wait for all downloads to complete
    const videoData = await Promise.all(videoPromises)

    // Sort by index to maintain order
    videoData.sort((a, b) => a.index - b.index)

    // Send messages sequentially but with pre-downloaded data
    for (const data of videoData) {
      try {
        if (data.thumbnailBuffer) {
          await sock.sendMessage(remoteJid, {
            image: data.thumbnailBuffer,
            caption: data.videoText,
            mimetype: "image/jpeg",
          })
        } else {
          await sock.sendMessage(remoteJid, { text: data.videoText })
        }
      } catch (error) {
        await sock.sendMessage(remoteJid, { text: data.videoText })
      }

      // Minimal delay for WhatsApp ordering
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const qualityInstructions = `✅ All ${videos.length} videos loaded!\n\n🎬 Quality Options:\n🔹 480 - 480p SD\n🔹 720 - 720p HD\n🔹 1080 - 1080p FHD\n\n📝 Format: <video_number> <quality>\nExamples: 1 1080, 3 720, 5 480`

    await sock.sendMessage(remoteJid, { text: qualityInstructions })
  } catch (error) {
    console.error("Error sending channel videos:", error)
    await sock.sendMessage(remoteJid, { text: "❌ Error displaying channel videos." })
  }
}

// Parse YouTube download progress with optimization
export function parseYouTubeProgress(line, progressTracker) {
  try {
    if (line.includes("[download]") && line.includes("%")) {
      if (line.includes("fragment") || line.includes("audio only")) {
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
  } catch (error) {
    console.log("YouTube progress parsing error:", error.message)
  }
}

// Enhanced YouTube video download with optimized progress tracking
export async function downloadYouTubeVideo(videoUrl, quality = "1080", progressTracker = null) {
  let videoInfo = null
  const cookiePath = path.join(BASE_DIR, "youtube_cookies.txt")
  const hasCookies = fs.existsSync(cookiePath)

  const baseOptions = {
    noWarnings: true,
    noCheckCertificate: true,
    preferFreeFormats: true,
    youtubeSkipDashManifest: false,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    retries: 3,
    fragmentRetries: 3,
    sleepInterval: 1,
    maxSleepInterval: 5,
  }

  if (hasCookies) {
    baseOptions.cookies = cookiePath
  }

  try {
    videoInfo = await youtubedl(videoUrl, {
      ...baseOptions,
      dumpSingleJson: true,
    })

    const title = sanitize(videoInfo.title || `youtube_video_${Date.now()}`)
    const format = VIDEO_QUALITIES[quality]?.format || VIDEO_QUALITIES["720"].format
    const outputPathTemplate = path.join(TMP_DIR, `${title}_${quality}p.%(ext)s`)
    const expectedPath = path.join(TMP_DIR, `${title}_${quality}p.mp4`)

    const ytdlpArgs = [
      videoUrl,
      "--no-warnings",
      "--no-check-certificate",
      "--prefer-free-formats",
      "--youtube-skip-dash-manifest",
      "--user-agent",
      baseOptions.userAgent,
      "--retries",
      "3",
      "--fragment-retries",
      "3",
      "--sleep-interval",
      "1",
      "--max-sleep-interval",
      "5",
      "--output",
      outputPathTemplate,
      "--format",
      format,
      "--merge-output-format",
      "mp4",
      "--add-metadata",
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
              parseYouTubeProgress(line, progressTracker)
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
              parseYouTubeProgress(line, progressTracker)
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
          let downloadedPath = expectedPath
          if (!fs.existsSync(downloadedPath)) {
            const possibleExtensions = [".mkv", ".webm", ".mp4"]
            for (const ext of possibleExtensions) {
              const altPath = path.join(TMP_DIR, `${title}_${quality}p${ext}`)
              if (fs.existsSync(altPath)) {
                downloadedPath = altPath
                break
              }
            }
          }

          if (!fs.existsSync(downloadedPath)) {
            reject(new Error(`Output file not found after download`))
            return
          }

          const finalFilename = `${title}_${quality}p.${path.extname(downloadedPath).slice(1)}`
          const finalPath = path.join(FILES_DIR, finalFilename)

          fs.copyFileSync(downloadedPath, finalPath)

          resolve({
            success: true,
            filename: finalFilename,
            tempPath: downloadedPath,
            finalPath: finalPath,
            title: title,
            quality: VIDEO_QUALITIES[quality]?.label || `${quality}p`,
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
    console.error("YouTube download failed:", err.stderr || err.message || err)
    return { success: false, error: err.message || "Download failed", title: videoInfo?.title || "Unknown Video" }
  }
}

// Enhanced download and send video with optimized progress tracking
export async function downloadAndSendVideo(sock, remoteJid, video, quality) {
  try {
    await sock.sendPresenceUpdate("composing", remoteJid)

    const progressTracker = performanceManager.createOptimizedProgressTracker(sock, remoteJid, 1, "video")
    await progressTracker.start()

    const result = await downloadYouTubeVideo(video.url, quality, progressTracker)

    await progressTracker.itemCompleted(result.success)
    await progressTracker.finish()

    if (result.success) {
      const fileSize = getFileSize(result.finalPath)

      // Send completion and file info concurrently
      const [, sendResult] = await Promise.all([
        sock.sendMessage(remoteJid, {
          text: `✅ Download completed!\n📁 ${result.filename}\n📊 Size: ${fileSize}\n🎬 Quality: ${result.quality}\n\n📤 Sending...`,
        }),
        sock.sendMessage(remoteJid, {
          document: { url: result.finalPath },
          fileName: result.filename,
          mimetype: getMimetype(result.filename),
          caption: `🎥 ${video.title}\n\n📺 ${video.channelTitle}\n📊 Size: ${fileSize}\n🎬 Quality: ${result.quality}`,
        }),
      ])

      // Clean up temp file
      if (result.tempPath && fs.existsSync(result.tempPath)) {
        fs.unlinkSync(result.tempPath)
      }

      await sock.sendMessage(remoteJid, { text: `✅ Video sent successfully!\n💾 File saved permanently` })
    } else {
      await sock.sendMessage(remoteJid, { text: `❌ Download failed\n🔴 Error: ${result.error}` })
    }
    await sock.sendPresenceUpdate("available", remoteJid)
  } catch (error) {
    console.error("Error in downloadAndSendVideo:", error)
    await sock.sendMessage(remoteJid, { text: `❌ Download error: ${error.message}` })
    await sock.sendPresenceUpdate("available", remoteJid)
  }
}

// Handle video selection with quality (unchanged)
export async function handleVideoSelection(sock, messageInfo, selection, userStates) {
  const { remoteJid } = messageInfo
  const userState = userStates.get(remoteJid)

  if (!userState || (!userState.searchResults && !userState.channelVideos)) {
    await sock.sendMessage(remoteJid, { text: "❌ No search results found. Use /ys or /yc command first." })
    return
  }

  const parts = selection.trim().split(/\s+/)
  if (parts.length !== 2) {
    await sock.sendMessage(remoteJid, {
      text: "❌ Invalid format. Use: <video_number> <quality>\nExample: 2 1080 or 1 480",
    })
    return
  }

  const videoIndex = Number.parseInt(parts[0]) - 1
  const quality = parts[1]

  const videos = userState.searchResults || userState.channelVideos

  if (isNaN(videoIndex) || videoIndex < 0 || videoIndex >= videos.length) {
    await sock.sendMessage(remoteJid, { text: `❌ Invalid video number. Choose 1-${videos.length}` })
    return
  }

  if (!["480", "720", "1080"].includes(quality)) {
    await sock.sendMessage(remoteJid, { text: "❌ Invalid quality. Choose: 480, 720, or 1080" })
    return
  }

  const video = videos[videoIndex]
  await downloadAndSendVideo(sock, remoteJid, video, quality)
}

// Handle channel selection (unchanged)
export async function handleChannelSelection(sock, remoteJid, selection, userStates) {
  const userState = userStates.get(remoteJid)

  if (!userState || userState.state !== "channel_search_results") {
    await sock.sendMessage(remoteJid, { text: "❌ No channel search results found. Use /yc command first." })
    return
  }

  const parts = selection.trim().split(/\s+/)
  const channelIndex = Number.parseInt(parts[0]) - 1
  const videoCount = parts.length > 1 ? Math.min(Number.parseInt(parts[1]), 20) : 10

  if (isNaN(channelIndex) || channelIndex < 0 || channelIndex >= userState.searchResults.length) {
    await sock.sendMessage(remoteJid, { text: `❌ Invalid channel number. Choose 1-${userState.searchResults.length}` })
    return
  }

  const channel = userState.searchResults[channelIndex]

  try {
    await sock.sendPresenceUpdate("composing", remoteJid)
    await sock.sendMessage(remoteJid, {
      text: `📺 Getting latest ${videoCount} videos from *${channel.title}*...\n⏳ Please wait...`,
    })

    const videosResult = await getChannelLatestVideos(channel.id, videoCount)

    if (videosResult.success && videosResult.videos.length > 0) {
      userStates.set(remoteJid, {
        state: "channel_videos_results",
        channelVideos: videosResult.videos,
        selectedChannel: channel,
      })
      await sendChannelLatestVideos(sock, remoteJid, videosResult.videos, channel.title, videoCount)
    } else {
      await sock.sendMessage(remoteJid, {
        text: `❌ Failed to get videos from ${channel.title}: ${videosResult.error || "No videos found"}`,
      })
    }

    await sock.sendPresenceUpdate("available", remoteJid)
  } catch (error) {
    console.error("Channel videos fetch error:", error)
    await sock.sendMessage(remoteJid, { text: `❌ Failed to get channel videos: ${error.message}` })
    await sock.sendPresenceUpdate("available", remoteJid)
  }
}
