#!/usr/bin/env python3
"""
Pinterest API for WhatsApp Bot
Usage: python3 pinterest_api.py <search_query> <num_images>
"""

import sys
import json
import argparse
import os
from pathlib import Path
from pinterest_dl import PinterestDL
from io import StringIO
import contextlib

def search_pinterest_images(search_query, num_images=10, cookies_file="cookies.json"):
    """
    Search Pinterest for images and return JSON results
    
    Args:
        search_query (str): The search query
        num_images (int): Number of images to retrieve (max 50)
        cookies_file (str): Path to cookies file
    
    Returns:
        dict: JSON response with success status and image data
    """
    
    # Validate inputs
    if not search_query or search_query.strip() == "":
        return {
            "success": False,
            "error": "Search query cannot be empty",
            "images": []
        }
    
    # Limit number of images
    num_images = min(max(1, num_images), 50)
    
    # Set up file paths
    cookies_file_path = Path(cookies_file)
    cache_output_path = Path("pinterest_cache.json")
    
    try:
        # Check if cookies file exists
        if not cookies_file_path.exists():
            return {
                "success": False,
                "error": f"Cookies file '{cookies_file}' not found. Please ensure it exists in the bot directory.",
                "images": []
            }
        
        # Suppress all output from pinterest_dl
        with open(os.devnull, 'w') as devnull:
            with contextlib.redirect_stdout(devnull), contextlib.redirect_stderr(devnull):
                # Initialize PinterestDL with API client
                pinterest_downloader = (
                    PinterestDL.with_api(verbose=False)  # Disable verbose output
                    .with_cookies_path(str(cookies_file_path))
                )
                
                # Search for images and save the results to cache
                pinterest_downloader.search_and_download(
                    query=search_query,
                    output_dir=None,  # Do not download images, only cache the data
                    num=num_images,
                    min_resolution=(64, 64),  # Minimum resolution for images
                    cache_path=str(cache_output_path),
                    delay=0.3,  # Faster delay for bot usage
                    caption="json",  # Save full image data in the JSON cache
                )
        
        # Read and return the cached results
        if cache_output_path.exists():
            with open(cache_output_path, 'r', encoding='utf-8') as f:
                cached_data = json.load(f)
            
            # Clean up cache file
            cache_output_path.unlink()
            
            # Filter and format the results
            formatted_images = []
            for item in cached_data[:num_images]:
                if isinstance(item, dict) and 'src' in item:
                    formatted_images.append({
                        "src": item.get("src", ""),
                        "alt": item.get("alt", ""),
                        "origin": item.get("origin", ""),
                        "fallback_urls": item.get("fallback_urls", [])
                    })
            
            return {
                "success": True,
                "error": None,
                "images": formatted_images,
                "query": search_query,
                "requested_count": num_images,
                "actual_count": len(formatted_images)
            }
        else:
            return {
                "success": False,
                "error": "Cache file was not created. Pinterest search may have failed.",
                "images": []
            }
            
    except FileNotFoundError as e:
        return {
            "success": False,
            "error": f"File not found: {str(e)}",
            "images": []
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Pinterest search failed: {str(e)}",
            "images": []
        }
    finally:
        # Cleanup cache file if it exists
        if cache_output_path.exists():
            try:
                cache_output_path.unlink()
            except:
                pass

def main():
    """Main function for command line usage"""
    parser = argparse.ArgumentParser(description='Pinterest Image Search API')
    parser.add_argument('query', help='Search query for Pinterest images')
    parser.add_argument('count', type=int, nargs='?', default=10, 
                       help='Number of images to retrieve (default: 10, max: 50)')
    parser.add_argument('--cookies', default='cookies.json', 
                       help='Path to cookies file (default: cookies.json)')
    
    args = parser.parse_args()
    
    # Perform the search
    result = search_pinterest_images(args.query, args.count, args.cookies)
    
    # Output ONLY JSON result - no other text
    print(json.dumps(result, ensure_ascii=False))
    
    # Exit with appropriate code
    sys.exit(0 if result["success"] else 1)

if __name__ == "__main__":
    main()
