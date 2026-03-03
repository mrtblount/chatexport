/**
 * converter.ts — Port of chatexport.py parsing logic.
 * Converts ChatGPT & Claude bulk exports to clean Markdown files.
 */

import slugify from "slugify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date | null;
}

export interface Conversation {
  title: string;
  source: "chatgpt" | "claude";
  conversationId: string;
  created: Date;
  messages: Message[];
}

export type Platform = "chatgpt" | "claude";

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

export function detectPlatform(conversations: any[]): Platform {
  if (!conversations.length) {
    throw new Error("Conversations list is empty.");
  }
  const sample = conversations[0];
  if ("mapping" in sample && "current_node" in sample) {
    return "chatgpt";
  }
  if ("chat_messages" in sample) {
    return "claude";
  }
  throw new Error(
    "Could not detect export format. Expected ChatGPT or Claude."
  );
}

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

export function makeFilename(title: string, created: Date): string {
  let titleSlug = slugify(title, {
    lower: true,
    strict: true,
    trim: true,
  });

  // Enforce max 60 chars, break on word boundary
  if (titleSlug.length > 60) {
    titleSlug = titleSlug.substring(0, 60);
    const lastDash = titleSlug.lastIndexOf("-");
    if (lastDash > 20) {
      titleSlug = titleSlug.substring(0, lastDash);
    }
  }

  if (!titleSlug) {
    titleSlug = "untitled";
  }

  const y = created.getUTCFullYear();
  const m = String(created.getUTCMonth() + 1).padStart(2, "0");
  const d = String(created.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}-${titleSlug}`;
}

export function dedupeFilename(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let counter = 1;
  while (true) {
    const candidate = `${base}-${counter}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    counter++;
  }
}

// ---------------------------------------------------------------------------
// ChatGPT parser
// ---------------------------------------------------------------------------

const CHATGPT_SKIP_CONTENT_TYPES = new Set([
  "user_editable_context",
  "thoughts",
  "reasoning_recap",
  "tether_browsing_display",
  "system_error",
  "app_pairing_content",
]);

function parseChatGPTMessageContent(message: any): string | null {
  if (!message) return null;

  const authorRole = message.author?.role ?? "";
  if (authorRole === "system" || authorRole === "tool") return null;

  // Skip deleted messages
  if (message.weight === 0) return null;

  // Skip visually hidden
  if (message.metadata?.is_visually_hidden_from_conversation) return null;

  const content = message.content ?? {};
  const contentType: string = content.content_type ?? "";

  if (CHATGPT_SKIP_CONTENT_TYPES.has(contentType)) return null;

  const parts: any[] = content.parts ?? [];

  if (contentType === "text" || contentType === "multimodal_text") {
    const textParts: string[] = [];
    for (const part of parts) {
      if (typeof part === "string") {
        textParts.push(part);
      } else if (typeof part === "object" && part !== null) {
        textParts.push("[Image]");
      }
    }
    const text = textParts.join("\n").trim();
    return text || null;
  }

  if (contentType === "code") {
    const lang = content.language ?? "";
    let codeText = content.text ?? "";
    if (!codeText && parts.length) {
      codeText = typeof parts[0] === "string" ? parts[0] : "";
    }
    return codeText ? `\`\`\`${lang}\n${codeText}\n\`\`\`` : null;
  }

  if (contentType === "execution_output") {
    let outputText = content.text ?? "";
    if (!outputText && parts.length) {
      outputText = typeof parts[0] === "string" ? parts[0] : "";
    }
    return outputText ? `\`\`\`\n${outputText}\n\`\`\`` : null;
  }

  if (contentType === "tether_quote") {
    const quoteText: string = content.text ?? "";
    const title: string = content.title ?? "";
    const url: string = content.url ?? "";
    const lines: string[] = [];
    if (quoteText) {
      for (const line of quoteText.split("\n")) {
        lines.push(`> ${line}`);
      }
    }
    if (title || url) {
      let source = title || url;
      if (url && title) {
        source = `[${title}](${url})`;
      }
      lines.push(`> — ${source}`);
    }
    return lines.length ? lines.join("\n") : null;
  }

  // Fallback: try to extract strings from parts
  if (parts.length) {
    const textParts = parts.filter(
      (p: any) => typeof p === "string"
    ) as string[];
    const text = textParts.join("\n").trim();
    return text || null;
  }

  return null;
}

export function parseChatGPTConversations(conversations: any[]): Conversation[] {
  const results: Conversation[] = [];

  for (const conv of conversations) {
    const mapping: Record<string, any> = conv.mapping ?? {};
    const currentNode: string | undefined = conv.current_node;
    if (!Object.keys(mapping).length || !currentNode) continue;

    // Walk from current_node back to root via parent chain
    const chain: any[] = [];
    let nodeId: string | null = currentNode;
    while (nodeId && nodeId in mapping) {
      chain.push(mapping[nodeId]);
      nodeId = mapping[nodeId].parent ?? null;
    }
    chain.reverse(); // Root → leaf order

    // Extract messages
    const messages: Message[] = [];
    let firstUserText: string | null = null;

    for (const node of chain) {
      const msg = node.message;
      if (!msg) continue;

      const contentText = parseChatGPTMessageContent(msg);
      if (contentText === null) continue;

      const role = msg.author?.role ?? "unknown";
      if (role !== "user" && role !== "assistant") continue;

      const ts = msg.create_time;
      const msgTime = ts ? new Date(ts * 1000) : null;

      if (role === "user" && firstUserText === null) {
        firstUserText = contentText;
      }

      messages.push({
        role: role as "user" | "assistant",
        content: contentText,
        timestamp: msgTime,
      });
    }

    if (!messages.length) continue;

    // Title handling
    let title = conv.title ?? "";
    if (!title || title.toLowerCase() === "new chat") {
      if (firstUserText) {
        title = firstUserText.substring(0, 60).trim();
        if (firstUserText.length > 60) {
          const lastSpace = title.lastIndexOf(" ");
          if (lastSpace > 0) {
            title = title.substring(0, lastSpace) + "...";
          }
        }
      } else {
        title = "Untitled";
      }
    }

    const createTime = conv.create_time;
    const created = createTime ? new Date(createTime * 1000) : new Date();

    results.push({
      title,
      source: "chatgpt",
      conversationId: conv.conversation_id ?? conv.id ?? "",
      created,
      messages,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Claude parser
// ---------------------------------------------------------------------------

function parseClaudeMessageContent(
  msg: any,
  includeThinking: boolean
): string | null {
  const contentBlocks: any[] = msg.content ?? [];

  if (!contentBlocks.length) {
    const text: string = msg.text ?? "";
    return text.trim() || null;
  }

  const renderedParts: string[] = [];

  for (const block of contentBlocks) {
    const blockType: string = block.type ?? "";

    if (blockType === "text") {
      const text: string = block.text ?? "";
      if (text.trim()) {
        renderedParts.push(text);
      }
    } else if (blockType === "thinking") {
      if (includeThinking) {
        const thinkingText: string = block.thinking ?? "";
        if (thinkingText.trim()) {
          renderedParts.push(
            `<details>\n<summary>Thinking</summary>\n\n${thinkingText}\n</details>`
          );
        }
      }
    } else if (blockType === "voice_note") {
      const vnTitle = block.title ?? "Voice Note";
      const vnText: string = block.text ?? "";
      if (vnText.trim()) {
        renderedParts.push(`**${vnTitle}**\n\n${vnText}`);
      }
    }
    // Skip: tool_use, tool_result, token_budget
  }

  if (renderedParts.length) {
    return renderedParts.join("\n\n");
  }

  // All blocks skipped — fall back to top-level text
  const text: string = msg.text ?? "";
  return text.trim() || null;
}

export function parseClaudeConversations(
  conversations: any[],
  includeThinking: boolean = false
): Conversation[] {
  const results: Conversation[] = [];

  for (const conv of conversations) {
    const chatMessages: any[] = conv.chat_messages ?? [];
    if (!chatMessages.length) continue;

    const messages: Message[] = [];
    let firstUserText: string | null = null;

    for (const msg of chatMessages) {
      const sender: string = msg.sender ?? "";
      let role: "user" | "assistant" | null = null;
      if (sender === "human") role = "user";
      else if (sender === "assistant") role = "assistant";
      if (!role) continue;

      const contentText = parseClaudeMessageContent(msg, includeThinking);
      if (contentText === null) continue;

      const tsStr: string | undefined = msg.created_at;
      let msgTime: Date | null = null;
      if (tsStr) {
        try {
          msgTime = new Date(tsStr.replace("Z", "+00:00"));
          if (isNaN(msgTime.getTime())) msgTime = null;
        } catch {
          msgTime = null;
        }
      }

      if (role === "user" && firstUserText === null) {
        firstUserText = contentText;
      }

      messages.push({ role, content: contentText, timestamp: msgTime });
    }

    if (!messages.length) continue;

    let title = conv.name ?? "";
    if (!title) {
      if (firstUserText) {
        title = firstUserText.substring(0, 60).trim();
        if (firstUserText.length > 60) {
          const lastSpace = title.lastIndexOf(" ");
          if (lastSpace > 0) {
            title = title.substring(0, lastSpace) + "...";
          }
        }
      } else {
        title = "Untitled";
      }
    }

    const createdStr: string | undefined = conv.created_at;
    let created = new Date();
    if (createdStr) {
      try {
        const d = new Date(createdStr);
        if (!isNaN(d.getTime())) created = d;
      } catch {
        // keep default
      }
    }

    results.push({
      title,
      source: "claude",
      conversationId: conv.uuid ?? "",
      created,
      messages,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Markdown formatter
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<string, string> = {
  user: "Human",
  assistant: "Assistant",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTimestamp(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function formatMessageTimestamp(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function formatConversation(conv: Conversation): string {
  const lines: string[] = [];

  const titleEscaped = conv.title.replace(/"/g, '\\"');
  lines.push("---");
  lines.push(`title: "${titleEscaped}"`);
  lines.push(`source: ${conv.source}`);
  lines.push(`conversation_id: "${conv.conversationId}"`);
  lines.push(`created: ${formatTimestamp(conv.created)}`);
  lines.push(`message_count: ${conv.messages.length}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${conv.title}`);
  lines.push("");

  for (const msg of conv.messages) {
    const label = ROLE_LABELS[msg.role] ?? msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
    if (msg.timestamp) {
      lines.push(`## ${label} *(${formatMessageTimestamp(msg.timestamp)})*`);
    } else {
      lines.push(`## ${label}`);
    }
    lines.push("");
    lines.push(msg.content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// High-level export (used by the wizard UI)
// ---------------------------------------------------------------------------

export interface ExportResult {
  platform: Platform;
  totalLoaded: number;
  totalParsed: number;
  totalSkipped: number;
  files: { filename: string; content: string }[];
}

export function processExport(
  jsonData: any[],
  includeThinking: boolean = false
): ExportResult {
  const platform = detectPlatform(jsonData);

  let parsed: Conversation[];
  if (platform === "chatgpt") {
    parsed = parseChatGPTConversations(jsonData);
  } else {
    parsed = parseClaudeConversations(jsonData, includeThinking);
  }

  const usedNames = new Set<string>();
  const files: { filename: string; content: string }[] = [];

  for (const conv of parsed) {
    const base = makeFilename(conv.title, conv.created);
    const name = dedupeFilename(base, usedNames);
    const md = formatConversation(conv);
    files.push({ filename: `${name}.md`, content: md });
  }

  return {
    platform,
    totalLoaded: jsonData.length,
    totalParsed: parsed.length,
    totalSkipped: jsonData.length - parsed.length,
    files,
  };
}
