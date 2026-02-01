#!/usr/bin/env python3
"""Generate tandem.watch extension icons with new theme"""

from PIL import Image, ImageDraw
import os

# Get the script directory
script_dir = os.path.dirname(os.path.abspath(__file__))
ext_dir = os.path.join(script_dir, 'chrome-extension')

# Color scheme
DARK_BG = "#1E293B"
PRIMARY_PURPLE = "#7C3AED"
SECONDARY_CYAN = "#06B6D4"
ACCENT_CORAL = "#FF6B6B"

def create_icon(size):
    """Create icon at specified size"""
    img = Image.new('RGBA', (size, size), (30, 41, 59, 255))  # Dark slate background
    draw = ImageDraw.Draw(img)
    
    # Scale factors based on size
    scale = size / 128
    
    # Sync circles - left
    circle_radius = int(28 * scale)
    circle_x = int(35 * scale)
    circle_y = int(64 * scale)
    
    draw.ellipse([circle_x - circle_radius, circle_y - circle_radius, 
                  circle_x + circle_radius, circle_y + circle_radius],
                 outline=PRIMARY_PURPLE, width=max(1, int(3 * scale)))
    
    small_radius = int(22 * scale)
    draw.ellipse([circle_x - small_radius, circle_y - small_radius,
                  circle_x + small_radius, circle_y + small_radius],
                 outline=SECONDARY_CYAN, width=max(1, int(2.5 * scale)))
    
    # Sync circles - right
    circle_x2 = int(93 * scale)
    draw.ellipse([circle_x2 - circle_radius, circle_y - circle_radius,
                  circle_x2 + circle_radius, circle_y + circle_radius],
                 outline=PRIMARY_PURPLE, width=max(1, int(3 * scale)))
    
    draw.ellipse([circle_x2 - small_radius, circle_y - small_radius,
                  circle_x2 + small_radius, circle_y + small_radius],
                 outline=SECONDARY_CYAN, width=max(1, int(2.5 * scale)))
    
    # Play button left (triangle)
    play_offset = int(14 * scale)
    play_height = int(28 * scale)
    play_width = int(20 * scale)
    
    left_play_points = [
        (circle_x - play_width, circle_y - play_offset),
        (circle_x - play_width, circle_y + play_offset),
        (circle_x + play_width//2, circle_y)
    ]
    draw.polygon(left_play_points, fill=ACCENT_CORAL)
    
    # Play button right
    right_play_points = [
        (circle_x2 - play_width, circle_y - play_offset),
        (circle_x2 - play_width, circle_y + play_offset),
        (circle_x2 + play_width//2, circle_y)
    ]
    draw.polygon(right_play_points, fill=ACCENT_CORAL)
    
    # Connection line
    line_start_x = int(55 * scale)
    line_end_x = int(73 * scale)
    draw.line([(line_start_x, circle_y), (line_end_x, circle_y)],
              fill=SECONDARY_CYAN, width=max(1, int(2 * scale)))
    
    # Sync dot
    dot_radius = max(1, int(2.5 * scale))
    dot_x = int(64 * scale)
    draw.ellipse([dot_x - dot_radius, circle_y - dot_radius,
                  dot_x + dot_radius, circle_y + dot_radius],
                 fill=SECONDARY_CYAN)
    
    return img

# Create icons
sizes = {
    'icon16.png': 16,
    'icon48.png': 48,
    'icon128.png': 128
}

for filename, size in sizes.items():
    img = create_icon(size)
    filepath = os.path.join(ext_dir, 'images', filename)
    img.save(filepath)
    print(f"✓ Created {filepath} ({size}x{size})")

print("\n✅ All icons created successfully!")
