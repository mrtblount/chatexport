# chatexport

Convert ChatGPT and Claude bulk exports into clean, readable Markdown files.

One command. No config. No database.

## Quick Start

```bash
pip install python-slugify
python chatexport.py conversations.json
```

## Usage

```bash
# Point at the JSON file directly
python chatexport.py conversations.json

# Point at the export folder
python chatexport.py ~/Downloads/chatgpt-export/

# Point at a ZIP archive (auto-extracts)
python chatexport.py export.zip

# Custom output directory
python chatexport.py conversations.json -o ./my-chats

# Include Claude's thinking blocks
python chatexport.py conversations.json --include-thinking
```

## What It Does

- **Auto-detects** ChatGPT vs Claude export format
- **ChatGPT**: Correctly traverses the `mapping` tree via `current_node → parent` chain
- **Claude**: Parses the flat `chat_messages` array with typed content blocks
- Generates one `.md` file per conversation with YAML frontmatter
- Handles filename collisions, "New chat" titles, images, code blocks, and more

## Getting Your Export

### ChatGPT
1. Go to [Settings → Data Controls → Export Data](https://chat.openai.com/#settings/DataControls)
2. Click "Export" and wait for the email
3. Download the ZIP — it contains `conversations.json`

### Claude
1. Go to [Settings → Account → Export Data](https://claude.ai/settings)
2. Click "Export" and wait for the email
3. Download the ZIP — it contains `conversations.json`

## Output

```
output/
└── chatgpt/              # or claude/
    ├── 2022-12-26-who-should-receive-reparations.md
    ├── 2023-01-15-help-me-write-a-cover-letter.md
    └── ...
```

Each file looks like:

```markdown
---
title: "Who Should Receive Reparations"
source: chatgpt
conversation_id: "abc123..."
created: 2022-12-26T15:30:00
message_count: 12
---

# Who Should Receive Reparations

## Human *(2022-12-26 15:30)*

What are the main arguments for and against reparations?

---

## Assistant *(2022-12-26 15:31)*

There are several perspectives on this topic...
```

## Content Handling

### ChatGPT
| Content Type | Rendered As |
|---|---|
| `text` | Plain text |
| `multimodal_text` | Text + `[Image]` placeholders |
| `code` | Fenced code block |
| `execution_output` | Fenced code block |
| `tether_quote` | Blockquote with source |
| System/tool messages | Skipped |
| Deleted messages (`weight=0`) | Skipped |

### Claude
| Content Type | Rendered As |
|---|---|
| `text` | Plain text |
| `thinking` | Skipped (unless `--include-thinking`) |
| `voice_note` | Text with title |
| `tool_use` / `tool_result` | Skipped |

## Requirements

- Python 3.10+
- `python-slugify`

## License

MIT
