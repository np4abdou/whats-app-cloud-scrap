# Pinterest Integration Setup

## Prerequisites

1. **Install pinterest_dl Python package:**
   \`\`\`bash
   pip install pinterest_dl
   \`\`\`

2. **Ensure cookies.json exists:**
   - The cookies.json file should already be in your workspace
   - Make sure it contains valid Pinterest authentication cookies

## Files Required

- `pinterest_api.py` - The Pinterest API script (automatically created)
- `cookies.json` - Your Pinterest cookies (should already exist)

## Usage

### Basic Commands

- `/img one piece` - Get 10 One Piece images
- `/img naruto 20` - Get 20 Naruto images  
- `/img anime wallpaper 5` - Get 5 anime wallpapers

### Features

- **API-based**: Uses a dedicated Python API script for better reliability
- **Fast delivery**: Images sent one by one with minimal delay
- **Clean images**: No captions or metadata, just pure images
- **Flexible count**: 1-50 images per request
- **High quality**: Original resolution images from Pinterest
- **Progress tracking**: Shows progress for large image batches
- **Fallback URLs**: Tries multiple URLs if main image fails

### Command Format

\`\`\`
/img <search_query> [number_of_images]
\`\`\`

- `search_query`: What you want to search for
- `number_of_images`: Optional, defaults to 10, max 50

### Examples

\`\`\`
/img one piece
/img "anime aesthetic" 15
/img naruto shippuden 25
/img manga panels 8
\`\`\`

## API Details

The bot now uses `pinterest_api.py` which:
- Takes command line arguments: `python3 pinterest_api.py "query" count`
- Returns structured JSON responses
- Handles errors gracefully
- Cleans up temporary files automatically

## Troubleshooting

1. **"Cookies file not found"**: Ensure `cookies.json` exists in bot directory
2. **"API script not found"**: The `pinterest_api.py` file should be created automatically
3. **"No images found"**: Try different search terms
4. **Slow responses**: Pinterest may be rate limiting, try smaller numbers
5. **Images fail to load**: Some Pinterest URLs may be restricted, the bot will try fallback URLs

## Notes

- Images are sent without any text or captions as requested
- Maximum 50 images per request to prevent spam
- Progress updates every 5 images for large batches
- Automatic retry mechanism for failed image downloads
- Temporary files are automatically cleaned up
