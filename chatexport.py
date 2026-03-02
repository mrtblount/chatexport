#!/usr/bin/env python3
"""chatexport — Convert ChatGPT & Claude bulk exports to clean Markdown files.

Usage:
    python chatexport.py conversations.json
    python chatexport.py ~/Downloads/chatgpt-export/
    python chatexport.py export.zip
    python chatexport.py conversations.json -o ./my-chats
    python chatexport.py conversations.json --include-thinking
"""

import argparse
import json
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set

from slugify import slugify


# ---------------------------------------------------------------------------
# Format detection
# ---------------------------------------------------------------------------

def detect_platform(conversations: List[Dict]) -> str:
    """Auto-detect whether JSON came from ChatGPT or Claude."""
    if not conversations:
        sys.exit("Error: conversations list is empty.")
    sample = conversations[0]
    if "mapping" in sample and "current_node" in sample:
        return "chatgpt"
    if "chat_messages" in sample:
        return "claude"
    sys.exit("Error: could not detect export format. Expected ChatGPT or Claude.")


# ---------------------------------------------------------------------------
# Input loading (file / folder / zip)
# ---------------------------------------------------------------------------

def load_conversations(input_path: Path, tmp_dir: Optional[Path] = None) -> List[Dict]:
    """Load conversations.json from a file, folder, or ZIP archive."""
    if input_path.suffix == ".zip":
        if tmp_dir is None:
            sys.exit("Error: temp directory required for ZIP extraction.")
        with zipfile.ZipFile(input_path, "r") as zf:
            zf.extractall(tmp_dir)
        candidates = list(tmp_dir.rglob("conversations.json"))
        if not candidates:
            sys.exit(f"Error: no conversations.json found inside {input_path}")
        json_path = candidates[0]
    elif input_path.is_dir():
        json_path = input_path / "conversations.json"
        if not json_path.exists():
            sys.exit(f"Error: no conversations.json in {input_path}")
    else:
        json_path = input_path

    if not json_path.exists():
        sys.exit(f"Error: file not found: {json_path}")

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        sys.exit("Error: expected a JSON array of conversations.")
    return data


# ---------------------------------------------------------------------------
# Filename helpers
# ---------------------------------------------------------------------------

def make_filename(title: str, created: datetime) -> str:
    """Build a date-prefixed slug filename (no extension)."""
    title_slug = slugify(
        title,
        max_length=60,
        word_boundary=True,
        save_order=True,
    )
    if not title_slug:
        title_slug = "untitled"
    date_str = created.strftime("%Y-%m-%d")
    return f"{date_str}-{title_slug}"


def dedupe_filename(base: str, used: Set[str]) -> str:
    """Append -1, -2, etc. if base name already used."""
    if base not in used:
        used.add(base)
        return base
    counter = 1
    while True:
        candidate = f"{base}-{counter}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        counter += 1


# ---------------------------------------------------------------------------
# ChatGPT parser
# ---------------------------------------------------------------------------

def parse_chatgpt_message_content(message: Dict) -> Optional[str]:
    """Extract renderable text from a ChatGPT message node."""
    if message is None:
        return None

    author_role = message.get("author", {}).get("role", "")
    if author_role in ("system", "tool"):
        return None

    # Skip deleted messages
    if message.get("weight", 1) == 0:
        return None

    # Skip visually hidden messages
    meta = message.get("metadata", {})
    if meta.get("is_visually_hidden_from_conversation"):
        return None

    content = message.get("content", {})
    content_type = content.get("content_type", "")

    # Skip non-renderable content types
    skip_types = {
        "user_editable_context",
        "thoughts",
        "reasoning_recap",
        "tether_browsing_display",
        "system_error",
        "app_pairing_content",
    }
    if content_type in skip_types:
        return None

    parts = content.get("parts", [])

    if content_type == "text":
        text_parts = []
        for part in parts:
            if isinstance(part, str):
                text_parts.append(part)
            elif isinstance(part, dict):
                # Image or other rich content inside text parts
                text_parts.append("[Image]")
        text = "\n".join(text_parts).strip()
        return text if text else None

    if content_type == "multimodal_text":
        text_parts = []
        for part in parts:
            if isinstance(part, str):
                text_parts.append(part)
            elif isinstance(part, dict):
                text_parts.append("[Image]")
        text = "\n".join(text_parts).strip()
        return text if text else None

    if content_type == "code":
        lang = content.get("language", "")
        code_text = content.get("text", "")
        if not code_text and parts:
            code_text = parts[0] if isinstance(parts[0], str) else ""
        return f"```{lang}\n{code_text}\n```" if code_text else None

    if content_type == "execution_output":
        output_text = content.get("text", "")
        if not output_text and parts:
            output_text = parts[0] if isinstance(parts[0], str) else ""
        return f"```\n{output_text}\n```" if output_text else None

    if content_type == "tether_quote":
        quote_text = content.get("text", "")
        title = content.get("title", "")
        url = content.get("url", "")
        lines = []
        if quote_text:
            for line in quote_text.split("\n"):
                lines.append(f"> {line}")
        if title or url:
            source = title or url
            if url and title:
                source = f"[{title}]({url})"
            lines.append(f"> — {source}")
        return "\n".join(lines) if lines else None

    # Fallback for unknown types: try to get text from parts
    if parts:
        text_parts = [p for p in parts if isinstance(p, str)]
        text = "\n".join(text_parts).strip()
        return text if text else None

    return None


def parse_chatgpt_conversations(conversations: List[Dict]) -> List[Dict]:
    """Parse ChatGPT export into normalized conversation dicts."""
    results = []

    for conv in conversations:
        mapping = conv.get("mapping", {})
        current_node = conv.get("current_node")
        if not mapping or not current_node:
            continue

        # Walk from current_node back to root via parent chain
        chain = []
        node_id = current_node
        while node_id and node_id in mapping:
            chain.append(mapping[node_id])
            node_id = mapping[node_id].get("parent")
        chain.reverse()  # Root → leaf order

        # Extract messages
        messages = []
        first_user_text = None
        for node in chain:
            msg = node.get("message")
            if msg is None:
                continue

            content_text = parse_chatgpt_message_content(msg)
            if content_text is None:
                continue

            role = msg.get("author", {}).get("role", "unknown")
            if role not in ("user", "assistant"):
                continue

            ts = msg.get("create_time")
            msg_time = datetime.fromtimestamp(ts, tz=timezone.utc) if ts else None

            if role == "user" and first_user_text is None:
                first_user_text = content_text

            messages.append({
                "role": role,
                "content": content_text,
                "timestamp": msg_time,
            })

        if not messages:
            continue

        # Title handling
        title = conv.get("title", "") or ""
        if not title or title.lower() in ("new chat", ""):
            if first_user_text:
                title = first_user_text[:60].strip()
                if len(first_user_text) > 60:
                    title = title.rsplit(" ", 1)[0] + "..."
            else:
                title = "Untitled"

        create_time = conv.get("create_time")
        created = datetime.fromtimestamp(create_time, tz=timezone.utc) if create_time else datetime.now(tz=timezone.utc)

        results.append({
            "title": title,
            "source": "chatgpt",
            "conversation_id": conv.get("conversation_id", conv.get("id", "")),
            "created": created,
            "messages": messages,
        })

    return results


# ---------------------------------------------------------------------------
# Claude parser
# ---------------------------------------------------------------------------

def parse_claude_message_content(msg: Dict, include_thinking: bool = False) -> Optional[str]:
    """Extract renderable text from a Claude message."""
    content_blocks = msg.get("content", [])
    if not content_blocks:
        # Fall back to top-level text field
        text = msg.get("text", "")
        return text.strip() if text and text.strip() else None

    rendered_parts = []
    for block in content_blocks:
        block_type = block.get("type", "")

        if block_type == "text":
            text = block.get("text", "")
            if text.strip():
                rendered_parts.append(text)

        elif block_type == "thinking":
            if include_thinking:
                thinking_text = block.get("thinking", "")
                if thinking_text.strip():
                    rendered_parts.append(f"<details>\n<summary>Thinking</summary>\n\n{thinking_text}\n</details>")

        elif block_type == "voice_note":
            vn_title = block.get("title", "Voice Note")
            vn_text = block.get("text", "")
            if vn_text.strip():
                rendered_parts.append(f"**{vn_title}**\n\n{vn_text}")

        # Skip: tool_use, tool_result, token_budget
        # (no action needed — just don't append)

    if rendered_parts:
        return "\n\n".join(rendered_parts)

    # All blocks were skipped — fall back to top-level text
    text = msg.get("text", "")
    return text.strip() if text and text.strip() else None


def parse_claude_conversations(conversations: List[Dict], include_thinking: bool = False) -> List[Dict]:
    """Parse Claude export into normalized conversation dicts."""
    results = []

    for conv in conversations:
        chat_messages = conv.get("chat_messages", [])
        if not chat_messages:
            continue

        messages = []
        first_user_text = None

        for msg in chat_messages:
            sender = msg.get("sender", "")
            role = "user" if sender == "human" else "assistant" if sender == "assistant" else None
            if role is None:
                continue

            content_text = parse_claude_message_content(msg, include_thinking)
            if content_text is None:
                continue

            ts_str = msg.get("created_at")
            msg_time = None
            if ts_str:
                try:
                    msg_time = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    pass

            if role == "user" and first_user_text is None:
                first_user_text = content_text

            messages.append({
                "role": role,
                "content": content_text,
                "timestamp": msg_time,
            })

        if not messages:
            continue

        title = conv.get("name", "") or ""
        if not title:
            if first_user_text:
                title = first_user_text[:60].strip()
                if len(first_user_text) > 60:
                    title = title.rsplit(" ", 1)[0] + "..."
            else:
                title = "Untitled"

        created_str = conv.get("created_at")
        created = datetime.now(tz=timezone.utc)
        if created_str:
            try:
                created = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                pass

        results.append({
            "title": title,
            "source": "claude",
            "conversation_id": conv.get("uuid", ""),
            "created": created,
            "messages": messages,
        })

    return results


# ---------------------------------------------------------------------------
# Markdown writer
# ---------------------------------------------------------------------------

ROLE_LABELS = {
    "user": "Human",
    "assistant": "Assistant",
}


def format_conversation(conv: dict) -> str:
    """Render a normalized conversation dict as Markdown."""
    lines = []

    # Frontmatter
    created_str = conv["created"].strftime("%Y-%m-%dT%H:%M:%S")
    title_escaped = conv["title"].replace('"', '\\"')
    lines.append("---")
    lines.append(f'title: "{title_escaped}"')
    lines.append(f'source: {conv["source"]}')
    lines.append(f'conversation_id: "{conv["conversation_id"]}"')
    lines.append(f"created: {created_str}")
    lines.append(f"message_count: {len(conv['messages'])}")
    lines.append("---")
    lines.append("")
    lines.append(f"# {conv['title']}")
    lines.append("")

    for msg in conv["messages"]:
        label = ROLE_LABELS.get(msg["role"], msg["role"].title())
        ts = msg.get("timestamp")
        if ts:
            ts_str = ts.strftime("%Y-%m-%d %H:%M")
            lines.append(f"## {label} *({ts_str})*")
        else:
            lines.append(f"## {label}")
        lines.append("")
        lines.append(msg["content"])
        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


def write_conversations(conversations: List[Dict], output_dir: Path, platform: str) -> int:
    """Write all conversations to Markdown files. Returns count written."""
    platform_dir = output_dir / platform
    platform_dir.mkdir(parents=True, exist_ok=True)

    used_names: Set[str] = set()
    written = 0

    for conv in conversations:
        base = make_filename(conv["title"], conv["created"])
        name = dedupe_filename(base, used_names)
        file_path = platform_dir / f"{name}.md"

        md = format_conversation(conv)
        file_path.write_text(md, encoding="utf-8")
        written += 1

    return written


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Convert ChatGPT & Claude bulk exports to Markdown files.",
        epilog="Examples:\n"
               "  python chatexport.py conversations.json\n"
               "  python chatexport.py ~/Downloads/chatgpt-export/\n"
               "  python chatexport.py export.zip\n"
               "  python chatexport.py conversations.json -o ./my-chats\n"
               "  python chatexport.py conversations.json --include-thinking\n",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("input", type=Path, help="Path to conversations.json, folder, or ZIP")
    parser.add_argument("-o", "--output", type=Path, default=Path("output"), help="Output directory (default: ./output)")
    parser.add_argument("--include-thinking", action="store_true", help="Include Claude thinking blocks in output")

    args = parser.parse_args()

    # Load
    tmp_dir_ctx = tempfile.TemporaryDirectory() if args.input.suffix == ".zip" else None
    tmp_path = Path(tmp_dir_ctx.name) if tmp_dir_ctx else None
    try:
        conversations = load_conversations(args.input, tmp_path)
    finally:
        if tmp_dir_ctx:
            tmp_dir_ctx.cleanup()

    print(f"Loaded {len(conversations)} conversations")

    # Detect
    platform = detect_platform(conversations)
    print(f"Detected platform: {platform}")

    # Parse
    if platform == "chatgpt":
        parsed = parse_chatgpt_conversations(conversations)
    else:
        parsed = parse_claude_conversations(conversations, include_thinking=args.include_thinking)

    print(f"Parsed {len(parsed)} conversations (skipped {len(conversations) - len(parsed)} empty)")

    # Write
    count = write_conversations(parsed, args.output, platform)
    print(f"Wrote {count} files to {args.output / platform}/")


if __name__ == "__main__":
    main()
