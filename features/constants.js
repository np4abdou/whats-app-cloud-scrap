import path from "path"

// Base directory setup
export const BASE_DIR = path.resolve("./")
export const SESSION_DIR = path.join(BASE_DIR, "auth_info_baileys")
export const FILES_DIR = path.join(BASE_DIR, "files")
export const TMP_DIR = path.join(BASE_DIR, "tmp")
export const ANIME_DOWNLOAD_DIR = "/home/container/new/files"
export const PROGRESS_FILE = "/tmp/download_progress.json"
export const CHATS_FILE = path.join(".", "saved_chats.json")
export const MUSIC_DOWNLOAD_DIR = path.join(BASE_DIR, "downloads")

// Configuration
export const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".pdf", ".txt", ".doc", ".docx", ".mp4", ".mp3"]
export const YOUTUBE_API_KEY = "AIzaSyDVg1W8VQRSt8It1NF7yjufMiyKz4v2iX4" // Please use your own API key
export const DEFAULT_AUTO_REPLY = "Pong!"

// Video quality options
export const VIDEO_QUALITIES = {
  480: { format: "bestvideo[height<=480]+bestaudio/best[height<=480]", label: "480p SD" },
  720: { format: "bestvideo[height<=720]+bestaudio/best[height<=720]", label: "720p HD" },
  1080: { format: "bestvideo[height<=1080]+bestaudio/best[height<=1080]", label: "1080p FHD" },
}
