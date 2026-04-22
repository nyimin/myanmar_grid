import re

path = "/Users/nyimin/Library/CloudStorage/OneDrive-SharedLibraries-Triune/Stack Space - Documents/Code/MM Grid/web-map/src/index.css"

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add the new keyframes for centered slide in
new_keyframes = """
@keyframes slideInUpCentered {
  from { opacity: 0; transform: translate(-50%, calc(-50% + 15px)); }
  to   { opacity: 1; transform: translate(-50%, -50%); }
}
"""

if "@keyframes slideInUpCentered" not in content:
    idx = content.find("@keyframes slideInUp")
    content = content[:idx] + new_keyframes + content[idx:]

# Update the animation for .analysis-panel.panel--centered
old_css = "animation: slideInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;"
new_css = "animation: slideInUpCentered 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;"
content = content.replace(old_css, new_css)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("SUCCESS: index.css animation updated.")
