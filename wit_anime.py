import cloudscraper
from bs4 import BeautifulSoup
import urllib.parse
import subprocess
import os
import sys
import json
import time
import re
import threading
import math
from pathlib import Path

# Progress tracking file path
PROGRESS_FILE = "/tmp/download_progress.json"

def update_progress(session_id, status, progress=0, filename="", error="", total_size="", downloaded_size="", speed="", eta="", time_elapsed=""):
    """Update download progress in shared JSON file"""
    try:
        progress_data = {}
        if os.path.exists(PROGRESS_FILE):
            try:
                with open(PROGRESS_FILE, 'r') as f:
                    progress_data = json.load(f)
            except:
                progress_data = {}
        
        progress_data[session_id] = {
            "status": status,
            "progress": progress,
            "filename": filename,
            "error": error,
            "total_size": total_size,
            "downloaded_size": downloaded_size,
            "speed": speed,
            "eta": eta,
            "time_elapsed": time_elapsed,
            "timestamp": time.time()
        }
        
        with open(PROGRESS_FILE, 'w') as f:
            json.dump(progress_data, f, indent=2)
            
    except Exception as e:
        print(f"Progress update error: {e}")

def parse_ytdlp_progress(line, session_id, start_time):
    """Parse yt-dlp output line and extract progress information"""
    try:
        if "[download]" in line and "%" in line:
            percent_match = re.search(r'(\d+\.?\d*)%', line)
            if percent_match:
                progress = float(percent_match.group(1))
                
                size_match = re.search(r'of\s+([0-9.]+[KMGT]?iB)', line)
                total_size = size_match.group(1) if size_match else ""
                
                downloaded_match = re.search(r'(\d+\.?\d*[KMGT]?iB)\s+of', line)
                downloaded_size = downloaded_match.group(1) if downloaded_match else ""
                
                speed_match = re.search(r'at\s+([0-9.]+[KMGT]?iB/s)', line)
                speed = speed_match.group(1) if speed_match else ""
                
                eta_match = re.search(r'ETA\s+([0-9:]+)', line)
                eta = eta_match.group(1) if eta_match else ""
                
                # Calculate elapsed time
                elapsed_seconds = int(time.time() - start_time)
                minutes, seconds = divmod(elapsed_seconds, 60)
                hours, minutes = divmod(minutes, 60)
                time_elapsed = f"{hours:02d}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes:02d}:{seconds:02d}"
                
                update_progress(
                    session_id=session_id,
                    status="downloading",
                    progress=progress,
                    total_size=total_size,
                    downloaded_size=downloaded_size,
                    speed=speed,
                    eta=eta,
                    time_elapsed=time_elapsed
                )
                
        elif "[download] Destination:" in line:
            filename_match = re.search(r'\[download\] Destination: (.+)', line)
            if filename_match:
                filename = os.path.basename(filename_match.group(1))
                update_progress(session_id=session_id, status="starting", filename=filename)
                
        elif "[download] 100%" in line:
            # Calculate elapsed time for completed download
            elapsed_seconds = int(time.time() - start_time)
            minutes, seconds = divmod(elapsed_seconds, 60)
            hours, minutes = divmod(minutes, 60)
            time_elapsed = f"{hours:02d}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes:02d}:{seconds:02d}"
            
            update_progress(
                session_id=session_id, 
                status="completed", 
                progress=100, 
                eta="00:00",
                time_elapsed=time_elapsed
            )
            
    except Exception as e:
        print(f"Progress parsing error: {e}")

def get_search_results(query):
    """Search for anime with enhanced details"""
    base_url = "https://anime3rb.com/search?q="
    search_url = base_url + urllib.parse.quote_plus(query)
    scraper = cloudscraper.create_scraper()
    resp = scraper.get(search_url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    results = []
    
    for card in soup.select('div.title-card')[:15]:
        try:
            title_link = card.find('a', href=True)
            title_element = card.find('h2', class_='title-name')
            
            if not title_link or not title_element:
                continue
                
            title = title_element.text.strip()
            url = title_link['href']
            
            poster_img = card.find('img')
            poster_image = poster_img['src'] if poster_img else None
            
            details_section = card.find('a', class_='details')
            rating = None
            episode_count = None
            genres = []
            release_season = None
            description = None
            
            if details_section:
                genres_div = details_section.find('div', class_='genres')
                if genres_div:
                    genre_spans = genres_div.find_all('span')
                    genres = [span.text.strip() for span in genre_spans]
                
                badges = details_section.find_all('span', class_='badge')
                for badge in badges:
                    badge_text = badge.get_text(strip=True)
                    
                    if badge.find('svg') and any(path.get('d', '').startswith('M11.48 3.499') for path in badge.find_all('path')):
                        rating_match = re.search(r'(\d+\.?\d*)', badge_text)
                        if rating_match:
                            rating = float(rating_match.group(1))
                    
                    elif 'حلقات' in badge_text or 'حلقة' in badge_text:
                        episode_match = re.search(r'(\d+)', badge_text)
                        if episode_match:
                            episode_count = int(episode_match.group(1))
                    
                    elif re.search(r'\d{4}', badge_text):
                        release_season = badge_text
                
                synopsis_p = details_section.find('p', class_='synopsis')
                if synopsis_p:
                    description = synopsis_p.text.strip()
            
            anime_data = {
                "title": title,
                "url": url,
                "poster_image": poster_image,
                "rating": rating,
                "episode_count": episode_count,
                "genres": genres,
                "release_season": release_season,
                "description": description
            }
            
            results.append(anime_data)
            
        except Exception as e:
            continue
    
    return results

def get_episodes(title_url):
    """Get episodes list for anime"""
    scraper = cloudscraper.create_scraper()
    resp = scraper.get(title_url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    episodes = []
    for a in soup.select('a[href^="https://anime3rb.com/episode/"]'):
        video_data = a.find('div', class_='video-data')
        if video_data:
            span = video_data.find('span')
            if span:
                ep_text = span.text.strip()
                ep_number = ''.join(filter(str.isdigit, ep_text))
                if ep_number:
                    episodes.append((int(ep_number), a['href']))
    episodes.sort()
    return episodes

def get_available_qualities(episode_url):
    """Get available download qualities for episode"""
    scraper = cloudscraper.create_scraper()
    resp = scraper.get(episode_url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    qualities = {}
    quality_blocks = soup.select('div.flex.flex-col.flex-grow.sm\\:max-w-\\[300px\\].rounded-lg.overflow-hidden.bg-gray-50.dark\\:bg-dark-700')
    for block in quality_blocks:
        label = block.find('label')
        if label:
            label_text = label.text.strip()
            if "HEVC" in label_text:
                continue
            a_tag = block.find('a', href=True)
            if a_tag and a_tag['href'].startswith("https://anime3rb.com/download/"):
                if "1080p" in label_text:
                    qualities['1080p'] = a_tag['href']
                elif "720p" in label_text:
                    qualities['720p'] = a_tag['href']
                elif "480p" in label_text:
                    qualities['480p'] = a_tag['href']
    return qualities

def check_disk_space(directory):
    """Check available disk space in GB"""
    try:
        statvfs = os.statvfs(directory)
        free_bytes = statvfs.f_frsize * statvfs.f_bavail
        free_gb = free_bytes / (1024**3)
        return free_gb
    except:
        return None

def get_file_size(file_path):
    """Get file size in human readable format"""
    try:
        if not os.path.exists(file_path):
            return "Not Found"
        size_bytes = os.path.getsize(file_path)
        if size_bytes == 0:
            return "0 B"
        size_names = ["B", "KB", "MB", "GB"]
        i = int(math.floor(math.log(size_bytes, 1024)))
        p = math.pow(1024, i)
        s = round(size_bytes / p, 2)
        return f"{s} {size_names[i]}"
    except:
        return "Unknown"

def download_with_ytdlp(url, download_dir="/home/container/new/files", api_mode=False, session_id=None):
    """Download anime episode with enhanced progress tracking and file size detection"""
    if not os.path.exists(download_dir):
        os.makedirs(download_dir)

    # Check disk space
    free_space = check_disk_space(download_dir)
    if free_space and free_space < 1.0:
        error_msg = f"Low disk space: {free_space:.2f}GB available"
        if session_id:
            update_progress(session_id, "error", error=error_msg)
        return False, error_msg

    # Get list of files before download
    files_before = set()
    if os.path.exists(download_dir):
        files_before = set(os.listdir(download_dir))

    # Initialize progress tracking
    if session_id:
        update_progress(session_id, "initializing")

    # Record start time for elapsed time calculation
    start_time = time.time()

    # Optimized command for large files
    cmd = [
        "yt-dlp",
        "--extractor-args", "generic:impersonate",
        "--no-mtime",
        "--retries", "3",
        "--fragment-retries", "3", 
        "--retry-sleep", "5",
        "-P", download_dir,
        url
    ]
    
    try:
        if session_id:
            update_progress(session_id, "starting")
            
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )
        
        # Monitor output with progress tracking
        last_update_time = 0
        while True:
            output = process.stdout.readline()
            if output == '' and process.poll() is not None:
                break
            if output and session_id:
                # Update progress at most every 5 seconds
                current_time = time.time()
                if current_time - last_update_time >= 5 or "[download] 100%" in output:
                    parse_ytdlp_progress(output.strip(), session_id, start_time)
                    last_update_time = current_time
        
        return_code = process.poll()
        
        if return_code == 0:
            # Calculate final elapsed time
            elapsed_seconds = int(time.time() - start_time)
            minutes, seconds = divmod(elapsed_seconds, 60)
            hours, minutes = divmod(minutes, 60)
            time_elapsed = f"{hours:02d}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes:02d}:{seconds:02d}"
            
            if session_id:
                update_progress(
                    session_id=session_id, 
                    status="completed", 
                    progress=100,
                    eta="00:00",
                    time_elapsed=time_elapsed
                )
            
            # Find the newly downloaded file
            files_after = set()
            if os.path.exists(download_dir):
                files_after = set(os.listdir(download_dir))
            
            new_files = files_after - files_before
            if new_files:
                downloaded_file = list(new_files)[0]
                # Get file size
                file_path = os.path.join(download_dir, downloaded_file)
                file_size = get_file_size(file_path)
                return True, {"filename": downloaded_file, "size": file_size, "path": file_path}
            else:
                try:
                    files = [f for f in os.listdir(download_dir) if os.path.isfile(os.path.join(download_dir, f))]
                    if files:
                        latest_file = max(files, key=lambda f: os.path.getmtime(os.path.join(download_dir, f)))
                        file_path = os.path.join(download_dir, latest_file)
                        file_size = get_file_size(file_path)
                        return True, {"filename": latest_file, "size": file_size, "path": file_path}
                except:
                    pass
                return True, {"filename": "download_completed", "size": "Unknown", "path": download_dir}
        else:
            error_msg = f"Download failed with code {return_code}"
            if session_id:
                update_progress(session_id, "error", error=error_msg)
            return False, error_msg
            
    except Exception as e:
        error_msg = f"Download error: {str(e)}"
        if session_id:
            update_progress(session_id, "error", error=error_msg)
        return False, error_msg

# API functions for WhatsApp bot integration
def search_anime_api(query):
    """API function for WhatsApp bot integration - returns detailed anime info"""
    try:
        results = get_search_results(query)
        return {
            "success": True,
            "results": results
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def get_anime_episodes_api(title_url):
    """API function for WhatsApp bot integration"""
    try:
        episodes = get_episodes(title_url)
        return {
            "success": True,
            "episodes": [{"number": num, "url": url} for num, url in episodes]
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def get_episode_qualities_api(episode_url):
    """API function for WhatsApp bot integration"""
    try:
        qualities = get_available_qualities(episode_url)
        return {
            "success": True,
            "qualities": qualities
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def download_episode_api(download_url, download_dir="/home/container/new/files", session_id=None):
    """API function for WhatsApp bot integration with enhanced file info"""
    try:
        success, result = download_with_ytdlp(download_url, download_dir, api_mode=True, session_id=session_id)
        if success:
            if isinstance(result, dict):
                return {
                    "success": True,
                    "download_dir": download_dir,
                    "filename": result["filename"],
                    "size": result["size"],
                    "path": result["path"],
                    "session_id": session_id
                }
            else:
                # Fallback for old format
                return {
                    "success": True,
                    "download_dir": download_dir,
                    "filename": result,
                    "size": "Unknown",
                    "path": os.path.join(download_dir, result),
                    "session_id": session_id
                }
        else:
            return {
                "success": False,
                "error": result,
                "download_dir": download_dir,
                "session_id": session_id
            }
    except Exception as e:
        error_msg = str(e)
        if session_id:
            update_progress(session_id, "error", error=error_msg)
        return {
            "success": False,
            "error": error_msg,
            "download_dir": download_dir,
            "session_id": session_id
        }

def main():
    # Check if called with API mode
    if len(sys.argv) > 1 and sys.argv[1] == "api":
        if len(sys.argv) < 4:
            print(json.dumps({"success": False, "error": "Invalid API call"}))
            return
        
        action = sys.argv[2]
        
        if action == "search":
            query = sys.argv[3]
            result = search_anime_api(query)
            print(json.dumps(result))
        
        elif action == "episodes":
            title_url = sys.argv[3]
            result = get_anime_episodes_api(title_url)
            print(json.dumps(result))
        
        elif action == "qualities":
            episode_url = sys.argv[3]
            result = get_episode_qualities_api(episode_url)
            print(json.dumps(result))
        
        elif action == "download":
            download_url = sys.argv[3]
            download_dir = sys.argv[4] if len(sys.argv) > 4 else "/home/container/new/files"
            session_id = sys.argv[5] if len(sys.argv) > 5 else None
            result = download_episode_api(download_url, download_dir, session_id)
            print(json.dumps(result))
        
        else:
            print(json.dumps({"success": False, "error": "Unknown action"}))
        
        return

    # Original interactive mode (simplified)
    query = input("Enter search query: ").strip()
    results = get_search_results(query)
    if not results:
        print("No results found.")
        return
    
    print("\nSearch Results:")
    for idx, anime in enumerate(results, 1):
        print(f"{idx}) {anime['title']}")
        if anime['rating']:
            print(f"   Rating: {anime['rating']}")
        if anime['episode_count']:
            print(f"   Episodes: {anime['episode_count']}")
        print()
    
    while True:
        try:
            choice = int(input(f"\nChoose a title (1-{len(results)}): "))
            if 1 <= choice <= len(results):
                break
            else:
                print("Invalid choice.")
        except ValueError:
            print("Please enter a number.")
    
    chosen_anime = results[choice - 1]
    chosen_title, chosen_url = chosen_anime['title'], chosen_anime['url']
    print(f"\nSelected: {chosen_title}")

    episodes = get_episodes(chosen_url)
    if not episodes:
        print("No episodes found.")
        return

    # Display episodes in grid
    print("\nEpisodes:")
    for i, (ep_num, _) in enumerate(episodes, 1):
        print(f"{ep_num:3}", end=' | ' if i % 6 else '\n')
    if len(episodes) % 6:
        print()

    ep_numbers = [ep_num for ep_num, _ in episodes]
    while True:
        try:
            ep_choice = int(input("\nChoose episode: "))
            if ep_choice in ep_numbers:
                break
            else:
                print("Invalid episode.")
        except ValueError:
            print("Please enter a number.")

    ep_url = None
    for ep_num, url in episodes:
        if ep_num == ep_choice:
            ep_url = url
            break

    print(f"\nFetching qualities for episode {ep_choice}...")
    qualities = get_available_qualities(ep_url)

    if not qualities:
        print("No download links found.")
        return

    print("\nAvailable qualities:")
    sorted_qualities = sorted(qualities.keys(), reverse=True)
    for i, q in enumerate(sorted_qualities, 1):
        print(f"{i}) {q}")

    while True:
        try:
            q_choice = int(input(f"\nChoose quality (1-{len(qualities)}): "))
            if 1 <= q_choice <= len(qualities):
                break
            else:
                print("Invalid choice.")
        except ValueError:
            print("Please enter a number.")

    selected_quality = sorted_qualities[q_choice - 1]
    download_link = qualities[selected_quality]

    print(f"\nSelected: {selected_quality}")
    print("Download URL:", download_link)

    action = input("\nDownload? (y/n): ").strip().lower()
    if action == 'y':
        success, result = download_with_ytdlp(download_link)
        if success:
            if isinstance(result, dict):
                print(f"✅ Download completed: {result['filename']} ({result['size']})")
            else:
                print(f"✅ Download completed: {result}")
        else:
            print(f"❌ Download failed: {result}")

if __name__ == "__main__":
    main()
