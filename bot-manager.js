// Bot Process Manager - Handles automatic restarts
import { spawn } from "child_process"

const BOT_SCRIPT = "bot.js"
const MAX_RESTARTS = 10000000
const RESTART_DELAY = 2000 // 2 seconds

let restartCount = 0
let botProcess = null
let isShuttingDown = false

function startBot() {
  if (isShuttingDown) return

  console.log(`🚀 Starting bot... (Attempt ${restartCount + 1}/${MAX_RESTARTS})`)

  botProcess = spawn("node", [BOT_SCRIPT], {
    stdio: "inherit",
    cwd: process.cwd(),
  })

  botProcess.on("exit", (code, signal) => {
    if (isShuttingDown) {
      console.log("🛑 Bot manager shutting down...")
      return
    }

    console.log(`📱 Bot process exited with code ${code}, signal ${signal}`)

    if (code === 0) {
      // Normal restart requested
      console.log("🔄 Restart requested, restarting bot...")
      setTimeout(startBot, RESTART_DELAY)
    } else if (code === 1) {
      // Stop requested
      console.log("🛑 Stop requested, shutting down...")
      process.exit(0)
    } else {
      // Unexpected exit
      if (restartCount < MAX_RESTARTS) {
        restartCount++
        console.log(`⚠️ Unexpected exit, restarting in ${RESTART_DELAY / 1000} seconds...`)
        setTimeout(startBot, RESTART_DELAY)
      } else {
        console.log("❌ Max restart attempts reached, shutting down...")
        process.exit(1)
      }
    }
  })

  botProcess.on("error", (error) => {
    console.error("❌ Bot process error:", error)
    if (restartCount < MAX_RESTARTS) {
      restartCount++
      setTimeout(startBot, RESTART_DELAY)
    }
  })

  // Reset restart count on successful start
  setTimeout(() => {
    if (botProcess && !botProcess.killed) {
      restartCount = 0
    }
  }, 30000) // Reset after 30 seconds of successful running
}

// Handle process signals
process.on("SIGINT", () => {
  console.log("\n🛑 Received SIGINT, shutting down bot manager...")
  isShuttingDown = true
  if (botProcess) {
    botProcess.kill("SIGINT")
  }
  setTimeout(() => process.exit(0), 5000)
})

process.on("SIGTERM", () => {
  console.log("\n🛑 Received SIGTERM, shutting down bot manager...")
  isShuttingDown = true
  if (botProcess) {
    botProcess.kill("SIGTERM")
  }
  setTimeout(() => process.exit(0), 5000)
})

console.log("🤖 WhatsApp Bot Manager Starting...")
console.log("🔧 Use Ctrl+C to stop the bot manager")
console.log("📱 Bot will automatically restart on crashes")
console.log("🔄 /restart command will trigger clean restart")
console.log("🛑 /stop command will shut down completely")

startBot()
