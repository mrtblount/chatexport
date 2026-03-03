/**
 * app.ts — Wizard flow logic for chatexport desktop app.
 */

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, readFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { unzipSync } from "fflate";
import { processExport, type Platform } from "./converter";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let selectedPlatform: Platform | null = null;
let inputFilePath: string | null = null;
let outputFolderPath: string | null = null;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const steps = {
  welcome: document.getElementById("step-welcome")!,
  instructions: document.getElementById("step-instructions")!,
  files: document.getElementById("step-files")!,
  processing: document.getElementById("step-processing")!,
};

// ---------------------------------------------------------------------------
// Step navigation
// ---------------------------------------------------------------------------

function goToStep(stepId: keyof typeof steps, from?: keyof typeof steps) {
  if (from) {
    const prev = steps[from];
    prev.classList.remove("active");
    prev.classList.add("exit-left");
    setTimeout(() => prev.classList.remove("exit-left"), 300);
  }
  // Deactivate all
  Object.values(steps).forEach((el) => el.classList.remove("active"));
  // Activate target
  steps[stepId].classList.add("active");
}

// ---------------------------------------------------------------------------
// Step 1: Welcome — pick platform
// ---------------------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>(".platform-card").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedPlatform = btn.dataset.platform as Platform;

    // Update instructions step
    const title = document.getElementById("instructions-title")!;
    title.textContent =
      selectedPlatform === "chatgpt"
        ? "How to export from ChatGPT"
        : "How to export from Claude";

    document.getElementById("instructions-chatgpt")!.style.display =
      selectedPlatform === "chatgpt" ? "block" : "none";
    document.getElementById("instructions-claude")!.style.display =
      selectedPlatform === "claude" ? "block" : "none";

    // Show thinking option only for Claude
    document.getElementById("thinking-option")!.style.display =
      selectedPlatform === "claude" ? "block" : "none";

    goToStep("instructions", "welcome");
  });
});

// ---------------------------------------------------------------------------
// Step 2: Instructions
// ---------------------------------------------------------------------------

document.getElementById("btn-back-instructions")!.addEventListener("click", () => {
  goToStep("welcome", "instructions");
});

document.getElementById("btn-continue")!.addEventListener("click", () => {
  // Reset file selections when entering this step
  inputFilePath = null;
  outputFolderPath = null;
  document.getElementById("input-path")!.textContent = "No file selected";
  document.getElementById("output-path")!.textContent = "No folder selected";
  document.getElementById("btn-pick-input")!.classList.remove("selected");
  document.getElementById("btn-pick-output")!.classList.remove("selected");
  (document.getElementById("btn-convert") as HTMLButtonElement).disabled = true;

  goToStep("files", "instructions");
});

// ---------------------------------------------------------------------------
// Step 3: File selection
// ---------------------------------------------------------------------------

document.getElementById("btn-back-files")!.addEventListener("click", () => {
  goToStep("instructions", "files");
});

function updateConvertButton() {
  (document.getElementById("btn-convert") as HTMLButtonElement).disabled =
    !inputFilePath || !outputFolderPath;
}

document.getElementById("btn-pick-input")!.addEventListener("click", async () => {
  const result = await openDialog({
    title: "Select your export file",
    filters: [
      {
        name: "Export files",
        extensions: ["json", "zip"],
      },
    ],
    multiple: false,
    directory: false,
  });

  if (result) {
    inputFilePath = result as string;
    const shortName = inputFilePath.split("/").pop() ?? inputFilePath;
    document.getElementById("input-path")!.textContent = shortName;
    document.getElementById("btn-pick-input")!.classList.add("selected");
    updateConvertButton();
  }
});

document.getElementById("btn-pick-output")!.addEventListener("click", async () => {
  const result = await openDialog({
    title: "Choose output folder",
    directory: true,
    multiple: false,
  });

  if (result) {
    outputFolderPath = result as string;
    const shortName =
      outputFolderPath.split("/").pop() ?? outputFolderPath;
    document.getElementById("output-path")!.textContent = shortName;
    document.getElementById("btn-pick-output")!.classList.add("selected");
    updateConvertButton();
  }
});

// ---------------------------------------------------------------------------
// Step 4: Convert
// ---------------------------------------------------------------------------

document.getElementById("btn-convert")!.addEventListener("click", async () => {
  goToStep("processing", "files");

  // Show spinner
  document.getElementById("processing-spinner")!.style.display = "block";
  document.getElementById("processing-done")!.style.display = "none";
  document.getElementById("processing-error")!.style.display = "none";

  try {
    // Read the input file (handle both JSON and ZIP)
    let raw: string;
    if (inputFilePath!.toLowerCase().endsWith(".zip")) {
      const zipBytes = await readFile(inputFilePath!);
      const unzipped = unzipSync(new Uint8Array(zipBytes));
      // Find conversations.json inside the ZIP
      const convKey = Object.keys(unzipped).find((k) =>
        k.endsWith("conversations.json")
      );
      if (!convKey) {
        throw new Error("No conversations.json found inside the ZIP file.");
      }
      raw = new TextDecoder().decode(unzipped[convKey]);
    } else {
      raw = await readTextFile(inputFilePath!);
    }

    const jsonData = JSON.parse(raw);

    if (!Array.isArray(jsonData)) {
      throw new Error("Expected a JSON array of conversations.");
    }

    const includeThinking = (
      document.getElementById("include-thinking") as HTMLInputElement
    ).checked;

    // Process
    const result = processExport(jsonData, includeThinking);

    // Create output directory: outputFolder/platform/
    const platformDir = `${outputFolderPath}/${result.platform}`;
    await mkdir(platformDir, { recursive: true });

    // Write files
    for (const file of result.files) {
      await writeTextFile(`${platformDir}/${file.filename}`, file.content);
    }

    // Show done
    document.getElementById("processing-spinner")!.style.display = "none";
    document.getElementById("processing-done")!.style.display = "block";
    document.getElementById("done-summary")!.textContent =
      `Converted ${result.totalParsed} conversations to Markdown` +
      (result.totalSkipped > 0
        ? ` (${result.totalSkipped} empty skipped)`
        : "") +
      `.`;

    // Open folder button
    const folderToOpen = platformDir;
    document.getElementById("btn-open-folder")!.onclick = async () => {
      await invoke("open_folder", { path: folderToOpen });
    };
  } catch (err: any) {
    document.getElementById("processing-spinner")!.style.display = "none";
    document.getElementById("processing-error")!.style.display = "block";
    document.getElementById("error-message")!.textContent =
      err.message || String(err);
  }
});

// Error back button
document.getElementById("btn-error-back")!.addEventListener("click", () => {
  goToStep("files", "processing");
});

// Start over
document.getElementById("btn-start-over")!.addEventListener("click", () => {
  selectedPlatform = null;
  inputFilePath = null;
  outputFolderPath = null;
  goToStep("welcome", "processing");
});
