import { YOUTUBE_API_KEY } from "./constants.js"
import fetch from "node-fetch"
import { formatNumber } from "./utils.js"
import { downloadImage } from "./utils.js"

// Parse YouTube channel command
export function parseYouTubeChannelCommand(commandParts) {
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

// Search YouTube channels
export async function searchYouTubeChannels(query, maxResults = 5) {
  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(
      query,
    )}&maxResults=${maxResults}&order=relevance&key=${YOUTUBE_API_KEY}`
    const response = await fetch(searchUrl)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || "YouTube API request failed")
    }
    if (!data.items || data.items.length === 0) {
      return { success: false, error: "No channels found for this search query" }
    }

    const channelIds = data.items.map((item) => item.id.channelId).join(",")
    const statsUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet,brandingSettings&id=${channelIds}&key=${YOUTUBE_API_KEY}`
    const statsResponse = await fetch(statsUrl)
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

// Send channel search results
export async function sendChannelSearchResults(sock, remoteJid, channels) {
  try {
    await sock.sendMessage(remoteJid, {
      text: `📺 Found ${channels.length} channels:\n\n📝 Reply with number to see latest videos\nExample: 1 or 2`,
    })

    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i]
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

      try {
        const thumbnailBuffer = await downloadImage(channel.thumbnail)
        if (thumbnailBuffer) {
          await sock.sendMessage(remoteJid, {
            image: thumbnailBuffer,
            caption: channelText,
            mimetype: "image/jpeg",
          })
        } else {
          await sock.sendMessage(remoteJid, { text: channelText })
        }
      } catch (error) {
        await sock.sendMessage(remoteJid, { text: channelText })
      }

      await new Promise((resolve) => setTimeout(resolve, 800))
    }

    const instructions = `✅ All ${channels.length} channels loaded!\n\n📝 Reply with channel number to see latest videos\nExample: 1 (shows latest videos from first channel)\n\n💡 You can also specify how many videos: 1 10 (shows 10 latest videos)`

    await sock.sendMessage(remoteJid, { text: instructions })
  } catch (error) {
    console.error("Error sending channel search results:", error)
    await sock.sendMessage(remoteJid, { text: "❌ Error displaying channel results." })
  }
}
