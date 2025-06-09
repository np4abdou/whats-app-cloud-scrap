import { exec } from "child_process"
import { promisify } from "util"
import path from "path"
import fs from "fs"
import { BASE_DIR, ANIME_DOWNLOAD_DIR } from "./constants.js"
import { downloadImage, getFileSize } from "./utils.js"
import { ProgressTracker } from "./progress.js"
import { performanceManager } from "./performance.js"

const execAsync = promisify(exec)

// Enhanced anime command parser for automation
export function parseAnimeCommand(commandParts) {
  const fullCommand = commandParts.slice(1).join(" ")

  // Pattern: /anime <name> <episode> <quality>
  // Example: /anime "one piece" 124 1080
  const automatedMatch = fullCommand.match(/^(.+?)\s+(\d+(?:-\d+)?)\s+(480|720|1080)$/i)
  if (automatedMatch) {
    return {
      query: automatedMatch[1].replace(/^["']|["']$/g, "").trim(),
      episodes: automatedMatch[2],
      quality: automatedMatch[3],
      automated: true,
    }
  }

  // Regular search pattern
  return {
    query: fullCommand.replace(/^["']|["']$/g, "").trim(),
    automated: false,
  }
}

// Parse episode selection (single or range)
export function parseEpisodeSelection(selection, availableEpisodes) {
  const episodeNumbers = availableEpisodes.map((ep) => ep.number)

  if (selection.includes("-")) {
    const [start, end] = selection.split("-").map((num) => Number.parseInt(num.trim()))
    if (isNaN(start) || isNaN(end) || start > end) {
      return { valid: false, error: "Invalid range format" }
    }

    const requestedEpisodes = []
    for (let i = start; i <= end; i++) {
      if (episodeNumbers.includes(i)) requestedEpisodes.push(i)
    }

    if (requestedEpisodes.length === 0) {
      return { valid: false, error: `No episodes found in range ${start}-${end}` }
    }

    return { valid: true, isRange: true, episodes: requestedEpisodes, originalRange: `${start}-${end}` }
  } else {
    const episodeNumber = Number.parseInt(selection.trim())
    if (isNaN(episodeNumber) || !episodeNumbers.includes(episodeNumber)) {
      return { valid: false, error: `Episode ${episodeNumber} not available` }
    }
    return { valid: true, isRange: false, episodes: [episodeNumber] }
  }
}

// Optimized Python anime scraper integration with minimal logging
export async function callPythonAnimeScript(action, ...args) {
  try {
    const pythonScript = path.join(BASE_DIR, "wit_anime.py")
    const command = `python3 "${pythonScript}" api ${action} ${args.map((arg) => `"${arg}"`).join(" ")}`

    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 100,
      timeout: 0,
    })

    const lines = stdout.trim().split("\n")
    let jsonLine = lines[lines.length - 1]

    if (!jsonLine.startsWith("{")) {
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].startsWith("{")) {
          jsonLine = lines[i]
          break
        }
      }
    }

    return JSON.parse(jsonLine)
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// Optimized anime search with parallel processing
export async function searchAnimeWithPython(query) {
  return await callPythonAnimeScript("search", query)
}

export async function getAnimeEpisodesWithPython(titleUrl) {
  return await callPythonAnimeScript("episodes", titleUrl)
}

export async function getEpisodeQualitiesWithPython(episodeUrl) {
  return await callPythonAnimeScript("qualities", episodeUrl)
}

export async function downloadAnimeWithPython(downloadUrl, animeTitle, episodeNumber, quality, sessionId) {
  return await callPythonAnimeScript("download", downloadUrl, ANIME_DOWNLOAD_DIR, sessionId)
}

// Optimized anime file sending
export async function sendAnimeFile(sock, remoteJid, anime, episodeNumber, quality, filename) {
  try {
    const filePath = path.join(ANIME_DOWNLOAD_DIR, filename || `${anime.title}_Episode_${episodeNumber}_${quality}.mp4`)

    if (fs.existsSync(filePath)) {
      const fileSize = getFileSize(filePath)

      // Send notification and file concurrently
      const [, fileResult] = await Promise.all([
        sock.sendMessage(remoteJid, {
          text: `📤 Sending Episode ${episodeNumber}...\n📊 Size: ${fileSize}`,
        }),
        sock.sendMessage(remoteJid, {
          document: { url: filePath },
          fileName: filename || `${anime.title}_Episode_${episodeNumber}_${quality}.mp4`,
          mimetype: "video/mp4",
          caption: `🎌 ${anime.title}\n🎬 Episode ${episodeNumber}\n📊 Quality: ${quality}\n📦 Size: ${fileSize}`,
        }),
      ])

      await sock.sendMessage(remoteJid, { text: `✅ Episode ${episodeNumber} sent!` })
    }
  } catch (error) {
    console.error(`Error sending episode ${episodeNumber}:`, error)
    await sock.sendMessage(remoteJid, { text: `⚠️ Episode ${episodeNumber} downloaded but couldn't be sent` })
  }
}

// Optimized multiple episodes download with parallel processing
export async function downloadEpisodesWithQueue(
  sock,
  remoteJid,
  selectedAnime,
  episodeNumbers,
  episodes,
  quality,
  qualities,
) {
  const progressTracker = new ProgressTracker(sock, remoteJid, episodeNumbers.length, "episodes")
  await progressTracker.start()

  // Process episodes in batches for optimal performance
  const batchSize = 2 // Process 2 episodes at a time
  const batches = []

  for (let i = 0; i < episodeNumbers.length; i += batchSize) {
    batches.push(episodeNumbers.slice(i, i + batchSize))
  }

  for (const batch of batches) {
    const batchPromises = batch.map(async (episodeNumber) => {
      const episode = episodes.find((ep) => ep.number === episodeNumber)

      if (!episode) {
        await progressTracker.itemCompleted(`Episode ${episodeNumber}`, false)
        return { success: false, episodeNumber }
      }

      try {
        const sessionId = `${remoteJid}_ep${episodeNumber}_${Date.now()}`
        await progressTracker.updateCurrentItem(
          `${selectedAnime.title} Episode ${episodeNumber}`,
          "downloading",
          sessionId,
        )

        const episodeQualitiesResult = await getEpisodeQualitiesWithPython(episode.url)
        if (!episodeQualitiesResult.success) {
          await progressTracker.itemCompleted(`Episode ${episodeNumber}`, false)
          return { success: false, episodeNumber }
        }

        const downloadUrl = episodeQualitiesResult.qualities[quality]
        if (!downloadUrl) {
          await progressTracker.itemCompleted(`Episode ${episodeNumber}`, false)
          return { success: false, episodeNumber }
        }

        const result = await downloadAnimeWithPython(
          downloadUrl,
          selectedAnime.title,
          episodeNumber,
          quality,
          sessionId,
        )

        if (result.success) {
          await progressTracker.itemCompleted(`Episode ${episodeNumber}`, true)
          await sendAnimeFile(sock, remoteJid, selectedAnime, episodeNumber, quality, result.filename)
          return { success: true, episodeNumber, filename: result.filename }
        } else {
          await progressTracker.itemCompleted(`Episode ${episodeNumber}`, false)
          return { success: false, episodeNumber }
        }
      } catch (error) {
        await progressTracker.itemCompleted(`Episode ${episodeNumber}`, false)
        return { success: false, episodeNumber, error }
      }
    })

    // Wait for the current batch to complete before starting the next
    await Promise.all(batchPromises)
  }

  await progressTracker.finish()
}

// Optimized automated download process
export async function startAutomatedDownload(sock, remoteJid, selectedAnime, episodeNumbers, episodes, quality) {
  const qualityMap = { 480: "480p", 720: "720p", 1080: "1080p" }
  const selectedQuality = qualityMap[quality]

  if (episodeNumbers.length === 1) {
    // Single episode
    const episodeNumber = episodeNumbers[0]
    const episode = episodes.find((ep) => ep.number === episodeNumber)

    const progressTracker = new ProgressTracker(sock, remoteJid, 1, "episode")
    await progressTracker.start()

    const sessionId = `${remoteJid}_ep${episodeNumber}_${Date.now()}`
    await progressTracker.updateCurrentItem(`${selectedAnime.title} Episode ${episodeNumber}`, "downloading", sessionId)

    const qualitiesResult = await getEpisodeQualitiesWithPython(episode.url)
    if (!qualitiesResult.success) {
      await progressTracker.itemCompleted(`Episode ${episodeNumber}`, false)
      await progressTracker.finish()
      return
    }

    const downloadUrl = qualitiesResult.qualities[selectedQuality]
    if (!downloadUrl) {
      await progressTracker.itemCompleted(`Episode ${episodeNumber}`, false)
      await progressTracker.finish()
      return
    }

    const result = await downloadAnimeWithPython(
      downloadUrl,
      selectedAnime.title,
      episodeNumber,
      selectedQuality,
      sessionId,
    )
    await progressTracker.itemCompleted(`Episode ${episodeNumber}`, result.success)
    await progressTracker.finish()

    if (result.success) {
      await sendAnimeFile(sock, remoteJid, selectedAnime, episodeNumber, selectedQuality, result.filename)
    }
  } else {
    // Multiple episodes
    await downloadEpisodesWithQueue(sock, remoteJid, selectedAnime, episodeNumbers, episodes, selectedQuality, {})
  }
}

// Optimized anime command handler with parallel processing
export async function handleAnimeCommand(sock, remoteJid, commandParts, userStates) {
  try {
    const parsed = parseAnimeCommand(commandParts)

    if (!parsed.query) {
      await sock.sendMessage(remoteJid, {
        text: `❌ Please provide an anime name.

*Usage:*
• */anime <name>* - Interactive search
• */anime <name> <episode> <quality>* - Automated download
• */anime <name> <start-end> <quality>* - Range download

*Examples:*
• */anime naruto* - Search Naruto
• */anime "one piece" 124 1080* - Download episode 124
• */anime "death note" 1-6 720* - Download episodes 1-6

*Quality options:* 480, 720, 1080`,
      })
      return
    }

    await sock.sendPresenceUpdate("composing", remoteJid)
    await sock.sendMessage(remoteJid, { text: `🔍 Searching: "${parsed.query}"...` })

    const searchResult = await searchAnimeWithPython(parsed.query)

    if (!searchResult.success || searchResult.results.length === 0) {
      await sock.sendMessage(remoteJid, { text: `❌ No anime found for: "${parsed.query}"` })
      return
    }

    if (parsed.automated) {
      // Automated flow - show anime for confirmation first
      const anime = searchResult.results[0] // Take first result

      let confirmText = `🎌 *Anime Found:*\n\n*${anime.title}*\n`
      if (anime.rating) confirmText += `⭐ ${anime.rating}/10\n`
      if (anime.episode_count) confirmText += `📺 ${anime.episode_count} Episodes\n`
      if (anime.genres && anime.genres.length > 0) confirmText += `🎭 ${anime.genres.join(", ")}\n`

      confirmText += `\n*Requested:*\n📺 Episode(s): ${parsed.episodes}\n📊 Quality: ${parsed.quality}p\n\n`
      confirmText += `⚠️ *Confirm this anime?*\n📝 Reply *Y* to proceed or *N* to cancel`

      // Send anime poster with confirmation
      try {
        if (anime.poster_image) {
          const posterBuffer = await downloadImage(anime.poster_image)
          if (posterBuffer) {
            await sock.sendMessage(remoteJid, {
              image: posterBuffer,
              caption: confirmText,
              mimetype: "image/jpeg",
            })
          } else {
            await sock.sendMessage(remoteJid, { text: confirmText })
          }
        } else {
          await sock.sendMessage(remoteJid, { text: confirmText })
        }
      } catch (error) {
        await sock.sendMessage(remoteJid, { text: confirmText })
      }

      // Set user state for automated confirmation
      userStates.set(remoteJid, {
        state: "automated_anime_confirmation",
        selectedAnime: anime,
        episodes: parsed.episodes,
        quality: parsed.quality,
      })
    } else {
      // Interactive flow - show search results with parallel processing
      await sock.sendMessage(remoteJid, {
        text: `🎌 Found ${searchResult.results.length} anime for: "${parsed.query}"\n\n📝 Reply with number to select`,
      })

      // Prepare all anime messages for ordered sending
      const animePromises = searchResult.results.slice(0, 15).map(async (anime, i) => {
        let animeText = `*${i + 1}. ${anime.title}*\n`
        if (anime.rating) animeText += `⭐ ${anime.rating}/10\n`
        if (anime.episode_count) animeText += `📺 ${anime.episode_count} Episodes\n`
        if (anime.genres && anime.genres.length > 0) animeText += `🎭 ${anime.genres.slice(0, 3).join(", ")}\n`
        if (anime.release_season) animeText += `📅 ${anime.release_season}\n`
        if (anime.description) {
          const shortDesc =
            anime.description.length > 100 ? anime.description.substring(0, 100) + "..." : anime.description
          animeText += `📝 ${shortDesc}\n`
        }

        return {
          index: i,
          promise: performanceManager.throttleOperation(async () => {
            try {
              if (anime.poster_image) {
                const posterBuffer = await downloadImage(anime.poster_image)
                if (posterBuffer) {
                  return await sock.sendMessage(remoteJid, {
                    image: posterBuffer,
                    caption: animeText,
                    mimetype: "image/jpeg",
                  })
                } else {
                  return await sock.sendMessage(remoteJid, { text: animeText })
                }
              } else {
                return await sock.sendMessage(remoteJid, { text: animeText })
              }
            } catch (error) {
              return await sock.sendMessage(remoteJid, { text: animeText })
            }
          }),
        }
      })

      // Process anime messages in order
      for (let i = 0; i < animePromises.length; i++) {
        await animePromises[i].promise
      }

      await sock.sendMessage(remoteJid, {
        text: `✅ All ${Math.min(searchResult.results.length, 15)} anime loaded!\n\n📝 Reply with anime number (1-${Math.min(searchResult.results.length, 15)})\n\n💡 *Automation tip:* Use */anime "name" episode quality* for instant downloads\nExample: */anime "one piece" 124 1080*`,
      })

      userStates.set(remoteJid, {
        state: "anime_selection",
        searchResults: searchResult.results.slice(0, 15),
        query: parsed.query,
      })
    }

    await sock.sendPresenceUpdate("available", remoteJid)
  } catch (error) {
    console.error("Anime search error:", error)
    await sock.sendMessage(remoteJid, { text: `❌ Search failed: ${error.message}` })
    await sock.sendPresenceUpdate("available", remoteJid)
  }
}

// Handle automated anime confirmation
export async function handleAutomatedAnimeConfirmation(sock, remoteJid, confirmation, userStates) {
  const userState = userStates.get(remoteJid)

  if (!userState || userState.state !== "automated_anime_confirmation") {
    await sock.sendMessage(remoteJid, { text: "❌ No confirmation pending." })
    return
  }

  if (confirmation.toUpperCase() === "Y") {
    const { selectedAnime, episodes, quality } = userState

    try {
      await sock.sendMessage(remoteJid, { text: `✅ Confirmed! Getting episodes...` })

      const episodesResult = await getAnimeEpisodesWithPython(selectedAnime.url)
      if (!episodesResult.success || episodesResult.episodes.length === 0) {
        await sock.sendMessage(remoteJid, { text: `❌ No episodes found` })
        userStates.delete(remoteJid)
        return
      }

      const parseResult = parseEpisodeSelection(episodes, episodesResult.episodes)
      if (!parseResult.valid) {
        await sock.sendMessage(remoteJid, { text: `❌ ${parseResult.error}` })
        userStates.delete(remoteJid)
        return
      }

      // Start automated download
      await startAutomatedDownload(
        sock,
        remoteJid,
        selectedAnime,
        parseResult.episodes,
        episodesResult.episodes,
        quality,
      )
      userStates.delete(remoteJid)
    } catch (error) {
      await sock.sendMessage(remoteJid, { text: `❌ Error: ${error.message}` })
      userStates.delete(remoteJid)
    }
  } else if (confirmation.toUpperCase() === "N") {
    await sock.sendMessage(remoteJid, { text: `❌ Cancelled. Try searching again.` })
    userStates.delete(remoteJid)
  } else {
    await sock.sendMessage(remoteJid, { text: `❌ Please reply Y or N` })
  }
}

// Handle anime selection (interactive mode)
export async function handleAnimeSelection(sock, remoteJid, selection, userStates) {
  const userState = userStates.get(remoteJid)

  if (!userState || userState.state !== "anime_selection") {
    await sock.sendMessage(remoteJid, { text: "❌ No anime search active. Use /anime <query> first." })
    return
  }

  const animeIndex = Number.parseInt(selection.trim()) - 1

  if (isNaN(animeIndex) || animeIndex < 0 || animeIndex >= userState.searchResults.length) {
    await sock.sendMessage(remoteJid, { text: `❌ Invalid selection. Choose 1-${userState.searchResults.length}` })
    return
  }

  const selectedAnime = userState.searchResults[animeIndex]

  try {
    await sock.sendPresenceUpdate("composing", remoteJid)
    await sock.sendMessage(remoteJid, { text: `📺 Selected: ${selectedAnime.title}\n⏳ Getting episodes...` })

    const episodesResult = await getAnimeEpisodesWithPython(selectedAnime.url)

    if (!episodesResult.success || episodesResult.episodes.length === 0) {
      await sock.sendMessage(remoteJid, { text: `❌ No episodes found for: ${selectedAnime.title}` })
      userStates.delete(remoteJid)
      return
    }

    // Display episodes in grid format
    const episodes = episodesResult.episodes
    let episodesText = `🎬 Episodes for: ${selectedAnime.title}\n\n`
    const perRow = 6

    for (let i = 0; i < episodes.length; i++) {
      episodesText += `${episodes[i].number.toString().padStart(3, " ")}`
      if ((i + 1) % perRow === 0 || i === episodes.length - 1) {
        episodesText += "\n"
      } else {
        episodesText += " | "
      }
    }

    episodesText += `\n📝 *Episode Selection:*\n• Single: 1\n• Range: 1-10\n\n💡 Available: ${episodes.map((ep) => ep.number).join(", ")}`

    await sock.sendMessage(remoteJid, { text: episodesText })

    userStates.set(remoteJid, {
      state: "episode_selection",
      selectedAnime: selectedAnime,
      episodes: episodes,
    })

    await sock.sendPresenceUpdate("available", remoteJid)
  } catch (error) {
    console.error("Episode fetch error:", error)
    await sock.sendMessage(remoteJid, { text: `❌ Failed to fetch episodes: ${error.message}` })
    userStates.delete(remoteJid)
    await sock.sendPresenceUpdate("available", remoteJid)
  }
}

// Handle episode selection (interactive mode)
export async function handleEpisodeSelection(sock, remoteJid, selection, userStates) {
  const userState = userStates.get(remoteJid)

  if (!userState || userState.state !== "episode_selection") {
    await sock.sendMessage(remoteJid, { text: "❌ No episode list active. Search for anime first." })
    return
  }

  const parseResult = parseEpisodeSelection(selection, userState.episodes)

  if (!parseResult.valid) {
    await sock.sendMessage(remoteJid, { text: `❌ ${parseResult.error}\n\n💡 Examples: 5 or 1-10` })
    return
  }

  try {
    await sock.sendPresenceUpdate("composing", remoteJid)

    if (parseResult.isRange) {
      await sock.sendMessage(remoteJid, {
        text: `🎬 Selected range: ${parseResult.originalRange}\n📺 Episodes: ${parseResult.episodes.join(", ")}\n⏳ Checking qualities...`,
      })
    } else {
      await sock.sendMessage(remoteJid, {
        text: `🎬 Selected episode: ${parseResult.episodes[0]}\n⏳ Checking qualities...`,
      })
    }

    const firstEpisode = userState.episodes.find((ep) => ep.number === parseResult.episodes[0])
    const qualitiesResult = await getEpisodeQualitiesWithPython(firstEpisode.url)

    if (!qualitiesResult.success || Object.keys(qualitiesResult.qualities).length === 0) {
      await sock.sendMessage(remoteJid, { text: `❌ No download links found` })
      userStates.delete(remoteJid)
      return
    }

    const qualities = qualitiesResult.qualities
    const availableQualities = Object.keys(qualities).sort((a, b) => {
      const order = { "1080p": 3, "720p": 2, "480p": 1 }
      return order[b] - order[a]
    })

    let qualitiesText = `🎯 Available qualities:\n\n`
    availableQualities.forEach((quality, index) => {
      qualitiesText += `${index + 1}. 📊 ${quality}\n`
    })

    qualitiesText += `\n📝 Reply with quality number (1-${availableQualities.length})`

    await sock.sendMessage(remoteJid, { text: qualitiesText })

    userStates.set(remoteJid, {
      state: "quality_selection",
      selectedAnime: userState.selectedAnime,
      selectedEpisodes: parseResult.episodes,
      isRange: parseResult.isRange,
      episodes: userState.episodes,
      qualities: qualities,
      availableQualities: availableQualities,
    })

    await sock.sendPresenceUpdate("available", remoteJid)
  } catch (error) {
    console.error("Quality fetch error:", error)
    await sock.sendMessage(remoteJid, { text: `❌ Failed to fetch qualities: ${error.message}` })
    userStates.delete(remoteJid)
    await sock.sendPresenceUpdate("available", remoteJid)
  }
}

// Handle quality selection (interactive mode)
export async function handleQualitySelection(sock, remoteJid, selection, userStates) {
  const userState = userStates.get(remoteJid)

  if (!userState || userState.state !== "quality_selection") {
    await sock.sendMessage(remoteJid, { text: "❌ No quality selection active. Search for anime first." })
    return
  }

  const qualityIndex = Number.parseInt(selection.trim()) - 1

  if (isNaN(qualityIndex) || qualityIndex < 0 || qualityIndex >= userState.availableQualities.length) {
    await sock.sendMessage(remoteJid, { text: `❌ Invalid quality. Choose 1-${userState.availableQualities.length}` })
    return
  }

  const selectedQuality = userState.availableQualities[qualityIndex]

  try {
    await sock.sendPresenceUpdate("composing", remoteJid)

    if (userState.isRange) {
      await downloadEpisodesWithQueue(
        sock,
        remoteJid,
        userState.selectedAnime,
        userState.selectedEpisodes,
        userState.episodes,
        selectedQuality,
        userState.qualities,
      )
    } else {
      const episodeNumber = userState.selectedEpisodes[0]
      const downloadUrl = userState.qualities[selectedQuality]
      const sessionId = `${remoteJid}_ep${episodeNumber}_${Date.now()}`

      const progressTracker = new ProgressTracker(sock, remoteJid, 1, "episode")
      await progressTracker.start()

      await progressTracker.updateCurrentItem(
        `${userState.selectedAnime.title} Episode ${episodeNumber}`,
        "downloading",
        sessionId,
      )

      const downloadResult = await downloadAnimeWithPython(
        downloadUrl,
        userState.selectedAnime.title,
        episodeNumber,
        selectedQuality,
        sessionId,
      )

      await progressTracker.itemCompleted(`Episode ${episodeNumber}`, downloadResult.success)
      await progressTracker.finish()

      if (downloadResult.success) {
        await sendAnimeFile(
          sock,
          remoteJid,
          userState.selectedAnime,
          episodeNumber,
          selectedQuality,
          downloadResult.filename,
        )
      } else {
        await sock.sendMessage(remoteJid, { text: `❌ Download failed: ${downloadResult.error || "Unknown error"}` })
      }
    }

    userStates.delete(remoteJid)
    await sock.sendPresenceUpdate("available", remoteJid)
  } catch (error) {
    console.error("Download error:", error)
    await sock.sendMessage(remoteJid, { text: `❌ Download error: ${error.message}` })
    await sock.sendPresenceUpdate("available", remoteJid)
  }
}
