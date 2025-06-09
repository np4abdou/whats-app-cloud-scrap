import { exec } from "child_process"
import { promisify } from "util"
import fs from "fs"
import path from "path"
import fetch from "node-fetch"
import { BASE_DIR } from "./constants.js"

const execAsync = promisify(exec)

// Optimized HTTP client for Pinterest
const httpAgent = new (await import("http")).Agent({
  keepAlive: true,
  maxSockets: 20,
  timeout: 15000,
})

const httpsAgent = new (await import("https")).Agent({
  keepAlive: true,
  maxSockets: 20,
  timeout: 15000,
})

// Pinterest search and download functionality
export class PinterestSearcher {
  constructor() {
    this.cookiesFile = path.join(BASE_DIR, "cookies.json")
    this.apiScript = path.join(BASE_DIR, "pinterest_api.py")
  }

  // Parse Pinterest command (unchanged)
  parseCommand(commandParts) {
    const fullCommand = commandParts.slice(1).join(" ")

    const parts = fullCommand.split(/\s+/)
    const lastPart = parts[parts.length - 1]

    if (/^\d+$/.test(lastPart) && parts.length > 1) {
      return {
        query: parts
          .slice(0, -1)
          .join(" ")
          .replace(/^["']|["']$/g, "")
          .trim(),
        count: Math.min(Number.parseInt(lastPart), 50),
      }
    }

    return {
      query: fullCommand.replace(/^["']|["']$/g, "").trim(),
      count: 10,
    }
  }

  // FIXED: Better JSON extraction with error handling
  extractJSON(output) {
    try {
      // First try to parse the entire output
      return JSON.parse(output.trim())
    } catch (error) {
      // If that fails, try to find JSON in the output
      const lines = output.split("\n")

      // Look for lines that start and end with braces
      for (const line of lines) {
        const trimmedLine = line.trim()
        if (trimmedLine.startsWith("{") && trimmedLine.endsWith("}")) {
          try {
            return JSON.parse(trimmedLine)
          } catch (parseError) {
            continue
          }
        }
      }

      // Try to find JSON with regex
      const jsonMatch = output.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/s)
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0])
        } catch (parseError) {
          // Continue to error handling
        }
      }

      // If no valid JSON found, return a structured error
      console.error("Pinterest API output:", output.substring(0, 500))
      return {
        success: false,
        error: "Pinterest API returned invalid response. Check if pinterest_api.py exists and cookies.json is valid.",
        images: [],
      }
    }
  }

  // FIXED: Enhanced search with better error handling
  async searchImages(query, count = 10) {
    try {
      // Check prerequisites
      if (!fs.existsSync(this.cookiesFile)) {
        return {
          success: false,
          error: `Cookies file not found at ${this.cookiesFile}. Please ensure cookies.json exists in the bot directory.`,
          images: [],
        }
      }

      if (!fs.existsSync(this.apiScript)) {
        return {
          success: false,
          error: `Pinterest API script not found at ${this.apiScript}. Please ensure pinterest_api.py exists.`,
          images: [],
        }
      }

      const escapedQuery = query.replace(/"/g, '\\"')
      const command = `python3 "${this.apiScript}" "${escapedQuery}" ${count} --cookies "${this.cookiesFile}"`

      console.log(`🔍 Executing Pinterest search: ${query} (${count} images)`)

      const { stdout, stderr } = await execAsync(command, {
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 10,
      })

      // Check if we got any output
      if (!stdout || stdout.trim().length === 0) {
        console.error("Pinterest API stderr:", stderr)
        return {
          success: false,
          error: "Pinterest API returned no output. Check if python3 and pinterest_dl are installed.",
          images: [],
        }
      }

      const result = this.extractJSON(stdout)

      // Validate the result structure
      if (!result || typeof result !== "object") {
        return {
          success: false,
          error: "Pinterest API returned invalid data structure.",
          images: [],
        }
      }

      if (result.success) {
        console.log(`✅ Pinterest search successful: ${result.actual_count || result.images?.length || 0} images found`)
        return result
      } else {
        console.log(`❌ Pinterest search failed: ${result.error}`)
        return result
      }
    } catch (error) {
      console.error("Pinterest API execution failed:", error)

      if (error.code === "ETIMEDOUT") {
        return {
          success: false,
          error: "Pinterest search timed out. Try with fewer images or check your connection.",
          images: [],
        }
      }

      if (error.code === "ENOENT") {
        return {
          success: false,
          error: "Python3 not found. Please ensure Python 3 is installed and accessible.",
          images: [],
        }
      }

      return {
        success: false,
        error: `API execution failed: ${error.message}`,
        images: [],
      }
    }
  }

  // Optimized image download with connection pooling
  async downloadImage(url, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const isHttps = url.startsWith("https")
        const response = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
          timeout: 10000,
          agent: isHttps ? httpsAgent : httpAgent,
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        if (buffer.length < 100) {
          throw new Error("Invalid image data received")
        }

        return buffer
      } catch (error) {
        console.error(`Image download attempt ${attempt + 1} failed for ${url}:`, error.message)

        if (attempt === retries) {
          return null
        }

        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      }
    }
    return null
  }

  // HYBRID APPROACH: Parallel download + Sequential send for images
  async sendImages(sock, remoteJid, images, query) {
    let successCount = 0
    let failCount = 0

    await sock.sendMessage(remoteJid, {
      text: `🖼️ Sending ${images.length} images for "${query}"...\n⏳ Processing images...`,
    })

    // Prepare all image data and download images in parallel
    const imagePromises = images.map(async (image, i) => {
      let imageBuffer = null
      try {
        imageBuffer = await this.downloadImage(image.src)

        if (!imageBuffer && image.fallback_urls && image.fallback_urls.length > 0) {
          for (const fallbackUrl of image.fallback_urls) {
            imageBuffer = await this.downloadImage(fallbackUrl)
            if (imageBuffer) break
          }
        }
      } catch (error) {
        console.error(`Error downloading image ${i + 1}:`, error.message)
      }

      return {
        index: i,
        imageBuffer,
        src: image.src,
      }
    })

    // Wait for all downloads to complete
    const imageData = await Promise.all(imagePromises)

    // Sort by index to maintain order
    imageData.sort((a, b) => a.index - b.index)

    // Send images sequentially but with pre-downloaded data
    for (const data of imageData) {
      try {
        if (data.imageBuffer) {
          await sock.sendMessage(remoteJid, {
            image: data.imageBuffer,
            mimetype: "image/jpeg",
          })
          successCount++
        } else {
          console.log(`❌ Failed to download image ${data.index + 1}: ${data.src}`)
          failCount++
        }
      } catch (error) {
        console.error(`Error sending image ${data.index + 1}:`, error.message)
        failCount++
      }

      // Minimal delay for WhatsApp ordering
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    // Send completion message
    let resultText = `✅ Pinterest search completed!\n\n📊 Results for "${query}":\n• ✅ Sent: ${successCount}/${images.length} images`

    if (failCount > 0) {
      resultText += `\n• ❌ Failed: ${failCount} images`
    }

    resultText += `\n\n💡 Use /img <query> <number> for more searches`

    await sock.sendMessage(remoteJid, { text: resultText })
  }
}

// FIXED: Enhanced Pinterest command handler with better error handling
export async function handlePinterestCommand(sock, remoteJid, commandParts) {
  const searcher = new PinterestSearcher()

  try {
    const parsed = searcher.parseCommand(commandParts)

    if (!parsed.query) {
      await sock.sendMessage(remoteJid, {
        text: `❌ Please provide a search query.

*Usage:*
• */img <query>* - Get 10 images (default)
• */img <query> <number>* - Get specific number of images

*Examples:*
• */img one piece* - Get 10 One Piece images
• */img naruto 20* - Get 20 Naruto images
• */img anime wallpaper 5* - Get 5 anime wallpapers

*Note:* Maximum 50 images per request
*Requirements:* cookies.json file must exist in bot directory`,
      })
      return
    }

    await sock.sendPresenceUpdate("composing", remoteJid)
    await sock.sendMessage(remoteJid, {
      text: `🔍 Searching Pinterest for "${parsed.query}"...\n📊 Requesting ${parsed.count} images\n⏳ This may take a moment...`,
    })

    const result = await searcher.searchImages(parsed.query, parsed.count)

    // Enhanced error handling
    if (!result) {
      await sock.sendMessage(remoteJid, {
        text: `❌ Pinterest search failed: No response from API\n\n💡 Check if pinterest_api.py and cookies.json exist`,
      })
      return
    }

    if (result.success && result.images && result.images.length > 0) {
      await searcher.sendImages(sock, remoteJid, result.images, parsed.query)
    } else {
      let errorMessage = `❌ Pinterest search failed: ${result.error || "No images found"}`

      if (result.error && result.error.includes("cookies")) {
        errorMessage += `\n\n💡 Make sure cookies.json file exists in the bot directory with valid Pinterest cookies.`
      } else if (result.error && result.error.includes("pinterest_api.py")) {
        errorMessage += `\n\n💡 Make sure pinterest_api.py exists in the bot directory.`
      } else if (result.error && result.error.includes("python3")) {
        errorMessage += `\n\n💡 Make sure Python 3 is installed: apt install python3`
      }

      await sock.sendMessage(remoteJid, { text: errorMessage })
    }

    await sock.sendPresenceUpdate("available", remoteJid)
  } catch (error) {
    console.error("Pinterest search error:", error)
    await sock.sendMessage(remoteJid, {
      text: `❌ Search failed: ${error.message}\n\n💡 Try again or contact support if the issue persists.`,
    })
    await sock.sendPresenceUpdate("available", remoteJid)
  }
}
