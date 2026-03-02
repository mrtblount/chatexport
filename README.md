# chatexport

Convert your ChatGPT and Claude conversations into clean, readable Markdown files.

One command. That's it.

---

## What Is This?

If you've been using ChatGPT or Claude and want to keep your conversations as actual files you can read, search, and organize — this tool does that. It takes the export file you download from OpenAI or Anthropic and turns each conversation into its own Markdown (.md) file.

No accounts. No apps to install. No complicated setup. Just your conversations, as files, on your computer.

## Step-by-Step Guide

### 1. Export your conversations

**From ChatGPT:**
1. Go to https://chat.openai.com
2. Click your profile picture (bottom-left) → **Settings**
3. Go to **Data Controls** → **Export Data** → **Export**
4. Wait for the email from OpenAI (can take a few minutes to a few hours)
5. Click the download link in the email — you'll get a `.zip` file
6. Unzip it. Inside you'll find a file called `conversations.json` — that's the one we need

**From Claude:**
1. Go to https://claude.ai/settings
2. Scroll to **Export Data** → click **Export**
3. Wait for the email from Anthropic
4. Download and unzip — same deal, you'll find `conversations.json`

### 2. Install Python (if you don't have it)

You need Python on your computer. Most Macs already have it. To check, open **Terminal** (search for "Terminal" in Spotlight) and type:

```bash
python3 --version
```

If you see something like `Python 3.9.6` or higher, you're good. If not:
- **Mac**: Install from https://www.python.org/downloads/
- **Windows**: Install from https://www.python.org/downloads/ — check the box that says "Add Python to PATH" during install
- **Linux**: You probably already have it. If not: `sudo apt install python3`

### 3. Install the one dependency

Still in Terminal, run:

```bash
pip3 install python-slugify
```

This is a small library that helps create clean filenames. It's the only thing you need to install.

### 4. Download chatexport

You have two options:

**Option A — Download just the script** (simplest):
1. Go to https://github.com/mrtblount/chatexport
2. Click on `chatexport.py`
3. Click the download/raw button and save it somewhere easy to find (like your Downloads folder)

**Option B — Clone the repo** (if you're familiar with git):
```bash
git clone https://github.com/mrtblount/chatexport.git
cd chatexport
```

### 5. Run it

In Terminal, navigate to where you saved `chatexport.py` and point it at your export:

```bash
python3 chatexport.py conversations.json
```

That's it. It will auto-detect whether it's from ChatGPT or Claude, convert everything, and put the files in an `output/` folder.

**Some other ways to run it:**

```bash
# Point at the unzipped export folder
python3 chatexport.py ~/Downloads/chatgpt-export/

# Point at the ZIP file directly (no need to unzip)
python3 chatexport.py ~/Downloads/export.zip

# Put the output somewhere specific
python3 chatexport.py conversations.json -o ~/Documents/my-chats

# Include Claude's "thinking" blocks (the reasoning it does before answering)
python3 chatexport.py conversations.json --include-thinking
```

---

## What You Get

A folder of Markdown files, one per conversation:

```
output/
└── chatgpt/                  (or claude/)
    ├── 2023-03-15-help-me-plan-a-road-trip.md
    ├── 2023-06-22-explain-how-mortgages-work.md
    ├── 2024-01-08-python-script-for-renaming-files.md
    └── ...
```

Each file looks like this:

```markdown
---
title: "Help Me Plan a Road Trip"
source: chatgpt
conversation_id: "abc123..."
created: 2023-03-15T14:30:00
message_count: 8
---

# Help Me Plan a Road Trip

## Human *(2023-03-15 14:30)*

I'm planning a road trip from New York to Miami with two stops.
What route would you recommend?

---

## Assistant *(2023-03-15 14:30)*

Here's a great route with two stops along the way...

---

## Human *(2023-03-15 14:32)*

What about places to eat along the way?

---
```

Clean. Readable. Searchable. Every conversation in its own file, named by date and topic.

---

## FAQ

**How long does it take?**
Seconds. 1,500 conversations takes about 2-3 seconds.

**Do I need an internet connection?**
No. Everything runs locally on your computer. Your conversations never leave your machine.

**What if I have both ChatGPT and Claude exports?**
Run it twice — once for each. They'll go into separate subfolders (`output/chatgpt/` and `output/claude/`), so nothing gets mixed up.

**What about conversations titled "New chat"?**
The tool automatically replaces those with the first thing you said in the conversation, so the filename is actually useful.

**What happens to images I sent?**
They show up as `[Image]` in the text. The export files from OpenAI/Anthropic don't include the actual image data, just references.

**Can I open these files in Obsidian/Notion/any text editor?**
Yes. Markdown files work everywhere — Obsidian, VS Code, Notion (via import), Bear, iA Writer, or even just TextEdit/Notepad.

---

## For Developers

**How it works under the hood:**

- **ChatGPT** exports use a tree structure (`mapping` with parent/child node references). The tool walks from `current_node` backwards through the parent chain to reconstruct the correct message order — this avoids following deleted message branches that a naive depth-first traversal would hit.
- **Claude** exports use a flat `chat_messages` array, straightforward to iterate.
- Filenames are generated with `python-slugify` (date-prefixed, word-boundary-aware, max 60 chars). Collisions get `-1`, `-2` suffixes via an in-memory set.
- Content type handling filters out system messages, tool calls, memory injections, thinking blocks, and deleted messages — only human/assistant conversation text makes it through.

**Content type handling:**

| ChatGPT Type | Action |
|---|---|
| `text`, `multimodal_text` | Render (images become `[Image]`) |
| `code` | Fenced code block with language |
| `execution_output` | Fenced code block |
| `tether_quote` | Blockquote with source attribution |
| `user_editable_context`, `thoughts`, `reasoning_recap`, `tether_browsing_display`, `system_error` | Skip |

| Claude Type | Action |
|---|---|
| `text` | Render |
| `thinking` | Skip (or render with `--include-thinking`) |
| `voice_note` | Render with title |
| `tool_use`, `tool_result`, `token_budget` | Skip |

**Requirements:** Python 3.9+, `python-slugify`. Everything else is stdlib.

**Single file by design** — anyone can `wget` the script and run it. No package structure, no database, no config files.

## License

MIT
