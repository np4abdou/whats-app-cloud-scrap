from pathlib import Path
from pinterest_dl import PinterestDL
import json # Added import for json, though it's not strictly used for writing in this snippet, good practice for reading/writing cookies.

# --- Configuration ---
cookies_file_path = "cookies.json" # Ensure you have a valid cookies.json file
cache_output_path = "search_results.json" # Define the path where the scraped data will be cached in JSON format

# --- Get search query from user input ---
search_query = input("Enter your Pinterest search query: ").strip()

if not search_query:
    print("Error: Search query cannot be empty. Exiting.")
else:
    try:
        # Initialize PinterestDL with API client
        # The 'output_dir=None' ensures that images are not downloaded,
        # and data is only cached to the specified JSON file.
        pinterest_downloader = (
            PinterestDL.with_api(verbose=True) # Set verbose to True for detailed logging
            .with_cookies_path(cookies_file_path)
        )

        print(f"\nSearching for '{search_query}' and caching results to '{cache_output_path}'...")

        # Search for images and save the results to the specified cache_path
        # num: Number of images to retrieve
        # min_resolution: Minimum resolution for images (width, height)
        # delay: Delay between requests in seconds
        # caption="json": Save full image data in the JSON cache
        pinterest_downloader.search_and_download(
            query=search_query,
            output_dir=None,  # Do not download images, only cache the data
            num=50, # Number of images to retrieve
            min_resolution=(64, 64), # Minimum resolution for images
            cache_path=cache_output_path,
            delay=0.4,
            caption="json", # Save full image data in the JSON cache
        )

        print(f"\nSearch results successfully cached to {cache_output_path}")

    except FileNotFoundError:
        print(f"Error: The cookies file '{cookies_file_path}' was not found. Please ensure it exists and is named '{cookies_file_path}'.")
    except Exception as e:
        print(f"An error occurred: {e}")

