---
name: image-generator
description: Generate images using agnes-ai image API. Prefer the draw_picture tool; CLI is fallback. Supports size, quality, count.
---

# Image Generator

Generate images using the agnes-ai image API.

## Preferred: `draw_picture` tool

When available, call the `draw_picture` tool with at least `prompt`.  
When done, include `MEDIA:<absolute filepath>` in the reply so the channel can deliver the file.

## Fallback CLI

```bash
node "%USERPROFILE%/.openclaw/media-cli/agnes-media-cli.js" image --prompt "描述" [options]
```

Use `exec` with `timeout` **≥ 180** and `process poll` if needed.

## Options

| Flag / param | Description | Default |
|--------------|-------------|---------|
| `prompt` / `--prompt` | Image description (required) | - |
| `model` / `--model` | agnes-image-2.0-flash or agnes-image-2.1-flash | agnes-image-2.0-flash |
| `size` / `--size` | 512x512, 1024x1024, 1024x1792, or 1792x1024 | 1024x1024 |
| `quality` / `--quality` | standard or hd | standard |
| `n` / `--count` | Number of images (1-4) | 1 |

## Examples

```bash
# Generate a standard image
node "%USERPROFILE%/.openclaw/media-cli/agnes-media-cli.js" image --prompt "a cute cat sitting on a windowsill"

# Generate 2 HD images
node "%USERPROFILE%/.openclaw/media-cli/agnes-media-cli.js" image --prompt "a modern living room interior" --quality hd --count 2
```

## Output

Plugin saves to `$env:USERPROFILE/.openclaw/image-output/`.  
CLI may save under `media-output/`. Always use the path returned by the tool/CLI in `MEDIA:`.
