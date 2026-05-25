import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Local app paths. TRACKER_DATA_DIR lets advanced users store data outside the app folder.
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.TRACKER_DATA_DIR || path.join(rootDir, "data"));
const uploadsDir = path.join(dataDir, "uploads");
const defaultsDir = path.join(dataDir, "defaults");
const statePath = path.join(dataDir, "applications.json");
const aiSettingsPath = path.join(dataDir, "ai-settings.json");
const host = "127.0.0.1";
const port = Number(process.env.PORT || process.argv.find((arg) => arg.startsWith("--port="))?.split("=")[1] || 4174);
const maxBodyBytes = 80 * 1024 * 1024;

// Static file types served by the tiny built-in server.
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".txt", "text/plain; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
]);

await ensureStorage();

// API routes:
// GET  /api/state   -> read applications.json
// PUT  /api/state   -> save entries/master documents
// POST /api/upload  -> save one uploaded document to data/uploads or data/defaults
// GET  /api/ai/settings -> read AI provider settings without exposing the saved key
// PUT  /api/ai/settings -> save AI provider settings locally
// POST /api/ai/ask      -> ask the configured external model, if one is enabled
// GET  /uploads/*   -> download a saved document
createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/state" && request.method === "GET") return sendJson(response, await readState());
    if (url.pathname === "/api/state" && request.method === "PUT") return handleSaveState(request, response);
    if (url.pathname === "/api/upload" && request.method === "POST") return handleUpload(request, response);
    if (url.pathname === "/api/ai/settings" && request.method === "GET") return sendJson(response, await readPublicAiSettings());
    if (url.pathname === "/api/ai/settings" && request.method === "PUT") return handleSaveAiSettings(request, response);
    if (url.pathname === "/api/ai/ask" && request.method === "POST") return handleAiAsk(request, response);
    if (url.pathname.startsWith("/uploads/") && request.method === "GET") return serveUpload(url.pathname, response);
    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    sendJson(response, { error: "Server error" }, 500);
  }
}).listen(port, host, () => {
  console.log(`Application Tracker running at http://localhost:${port}`);
  console.log(`Tracker data: ${statePath}`);
  console.log(`Uploaded files: ${uploadsDir}`);
});

// Create the local data folder structure on first run.
async function ensureStorage() {
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(defaultsDir, { recursive: true });
  try {
    await stat(statePath);
  } catch {
    await writeFile(statePath, JSON.stringify({ entries: [], masterDocuments: [], updatedAt: new Date().toISOString() }, null, 2));
  }
}

// State is intentionally plain JSON so users can inspect, back up, or repair it by hand.
async function readState() {
  const parsed = JSON.parse(await readFile(statePath, "utf8"));
  return {
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    masterDocuments: Array.isArray(parsed.masterDocuments) ? parsed.masterDocuments : [],
    storage: "local-folder",
    dataPath: statePath,
    uploadsPath: uploadsDir,
    updatedAt: parsed.updatedAt || "",
  };
}

async function handleSaveState(request, response) {
  const body = await readJsonBody(request);
  const state = {
    entries: Array.isArray(body.entries) ? body.entries.map(stripDataUrlsFromEntry) : [],
    masterDocuments: Array.isArray(body.masterDocuments) ? body.masterDocuments.map(stripDataUrl) : [],
    updatedAt: new Date().toISOString(),
  };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  sendJson(response, { ok: true, ...state });
}

async function readAiSettings() {
  try {
    const parsed = JSON.parse(await readFile(aiSettingsPath, "utf8"));
    const provider = normalizeAiProvider(parsed.provider);
    if (!provider) return { provider: "", baseUrl: "", model: "", apiKey: "" };
    return {
      provider,
      baseUrl: String(parsed.baseUrl || defaultAiBaseUrl(provider)).trim(),
      model: String(parsed.model || defaultAiModel(provider)).trim(),
      apiKey: String(parsed.apiKey || "").trim(),
    };
  } catch {
    return { provider: "", baseUrl: "", model: "", apiKey: "" };
  }
}

async function readPublicAiSettings() {
  const settings = await readAiSettings();
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    hasApiKey: Boolean(settings.apiKey),
    configured: isAiConfigured(settings),
  };
}

async function handleSaveAiSettings(request, response) {
  const current = await readAiSettings();
  const body = await readJsonBody(request);
  const provider = normalizeAiProvider(body.provider);
  if (!provider) {
    await writeFile(aiSettingsPath, `${JSON.stringify({ provider: "", baseUrl: "", model: "", apiKey: "" }, null, 2)}\n`);
    sendJson(response, { ok: true, ...(await readPublicAiSettings()) });
    return;
  }
  const apiKeyNeeded = provider !== "ollama";
  const next = {
    provider,
    baseUrl: String(body.baseUrl || defaultAiBaseUrl(provider)).trim().replace(/\/+$/, ""),
    model: String(body.model || defaultAiModel(provider)).trim(),
    apiKey: apiKeyNeeded && body.apiKey === "" && current.provider === provider ? current.apiKey : String(body.apiKey || "").trim(),
  };
  if (body.clearApiKey || !apiKeyNeeded) next.apiKey = "";
  await writeFile(aiSettingsPath, `${JSON.stringify(next, null, 2)}\n`);
  sendJson(response, { ok: true, ...(await readPublicAiSettings()) });
}

async function handleAiAsk(request, response) {
  const settings = await readAiSettings();
  if (!isAiConfigured(settings)) {
    return sendJson(response, { error: "AI provider is not configured" }, 400);
  }
  const body = await readJsonBody(request);
  const question = String(body.question || "").trim();
  const context = String(body.context || "").slice(0, 60000);
  const history = normalizeAiHistory(body.history);
  if (!question) return sendJson(response, { error: "Question is required" }, 400);

  if (settings.provider === "gemini") return handleGeminiAsk(settings, question, context, history, response);
  return handleOpenAiCompatibleAsk(settings, question, context, history, response);
}

async function handleOpenAiCompatibleAsk(settings, question, context, history, response) {
  const messages = [
    {
      role: "system",
      content: aiSystemPrompt(),
    },
    {
      role: "user",
      content: `Tracker data for this conversation:\n${context}`,
    },
    ...history.map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    })),
  ];
  if (!history.length || history.at(-1)?.role !== "user" || history.at(-1)?.content !== question) {
    messages.push({ role: "user", content: question });
  }
  let apiResponse;
  try {
    apiResponse = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(45000),
      headers: {
        "Content-Type": "application/json",
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.3,
        messages,
      }),
    });
  } catch (error) {
    return sendJson(response, { error: providerConnectionMessage(settings.provider, error) }, 502);
  }

  const result = await apiResponse.json().catch(() => ({}));
  if (!apiResponse.ok) {
    return sendJson(response, parseAiProviderError(result, "AI provider request failed"), apiResponse.status);
  }
  sendJson(response, {
    answer: result.choices?.[0]?.message?.content || "",
    provider: settings.provider,
    model: settings.model,
  });
}

async function handleGeminiAsk(settings, question, context, history, response) {
  const model = settings.model.startsWith("models/") ? settings.model : `models/${settings.model}`;
  const url = `${settings.baseUrl.replace(/\/+$/, "")}/${model}:generateContent`;
  const contents = [
    {
      role: "user",
      parts: [{ text: `Tracker data for this conversation:\n${context}` }],
    },
    ...history.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
  ];
  if (!history.length || history.at(-1)?.role !== "user" || history.at(-1)?.content !== question) {
    contents.push({ role: "user", parts: [{ text: question }] });
  }
  let apiResponse;
  try {
    apiResponse = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(45000),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": settings.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: aiSystemPrompt() }],
        },
        contents,
        generationConfig: {
          temperature: 0.3,
        },
      }),
    });
  } catch (error) {
    return sendJson(response, { error: providerConnectionMessage(settings.provider, error) }, 502);
  }
  const result = await apiResponse.json().catch(() => ({}));
  if (!apiResponse.ok) {
    return sendJson(response, parseAiProviderError(result, "Gemini request failed"), apiResponse.status);
  }
  const answer = (result.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("").trim();
  sendJson(response, { answer, provider: settings.provider, model: settings.model });
}

function aiSystemPrompt() {
  return [
    "You help with academic applications using only the tracker data provided by the user.",
    "Use the conversation history to answer follow-up questions, including pronouns such as it, this, or that.",
    "Be precise, practical, and privacy-conscious.",
    "If asked to edit a document, suggest concrete replacements or revised sections instead of claiming to overwrite files.",
    "If data is missing or the request cannot be completed, say what is missing and give the next useful step.",
  ].join(" ");
}

function normalizeAiHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: String(message?.content || "").slice(0, 12000),
    }))
    .filter((message) => message.content.trim())
    .slice(-10);
}

function parseAiProviderError(result, fallback) {
  const error = result?.error || {};
  const details = Array.isArray(error.details) ? error.details : [];
  const retryInfo = details.find((item) => String(item["@type"] || "").includes("RetryInfo"));
  const quotaFailure = details.find((item) => String(item["@type"] || "").includes("QuotaFailure"));
  const retryAfterSeconds = parseRetryDelay(retryInfo?.retryDelay);
  const quota = quotaFailure?.violations?.[0]
    ? {
        metric: quotaFailure.violations[0].quotaMetric || "",
        id: quotaFailure.violations[0].quotaId || "",
        limit: quotaFailure.violations[0].quotaValue || "",
      }
    : null;
  return {
    error: error.message || fallback,
    retryAfterSeconds,
    quota,
  };
}

function providerConnectionMessage(provider, error) {
  const label = provider === "ollama" ? "Ollama" : provider || "AI provider";
  if (error?.name === "TimeoutError") return `${label} did not respond within 45 seconds. Try a smaller model, a shorter prompt, or check that the provider is running.`;
  if (provider === "ollama") return "Could not reach Ollama at the saved local URL. Make sure Ollama is running and the selected model is installed.";
  return `Could not reach ${label}. Check the API URL, key, model name, and internet connection.`;
}

function parseRetryDelay(value) {
  const match = String(value || "").match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Math.ceil(Number(match[1])) : 0;
}

function normalizeAiProvider(provider) {
  const value = String(provider || "").toLowerCase();
  if (!value) return "";
  if (["gemini", "ollama", "groq", "openrouter", "mistral", "openai-compatible"].includes(value)) return value;
  return "openai-compatible";
}

function defaultAiModel(provider) {
  return {
    gemini: "gemini-2.5-flash",
    ollama: "qwen2.5:0.5b",
    groq: "llama-3.1-8b-instant",
    openrouter: "openai/gpt-oss-20b:free",
    mistral: "mistral-small-latest",
  }[provider] || "";
}

function defaultAiBaseUrl(provider) {
  return {
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    ollama: "http://localhost:11434/v1",
    groq: "https://api.groq.com/openai/v1",
    openrouter: "https://openrouter.ai/api/v1",
    mistral: "https://api.mistral.ai/v1",
  }[provider] || "";
}

function isAiConfigured(settings) {
  if (!settings.provider) return false;
  if (settings.provider === "gemini") return Boolean(settings.apiKey && settings.model);
  return Boolean(settings.baseUrl && settings.model);
}

// Browser uploads arrive as data URLs, then the server writes real local files.
async function handleUpload(request, response) {
  const body = await readJsonBody(request);
  const dataUrl = String(body.dataUrl || "");
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return sendJson(response, { error: "Expected a base64 data URL" }, 400);

  const type = cleanText(body.type || "Document");
  const originalName = cleanFilename(body.name || "document");
  const extension = path.extname(originalName);
  const base = path.basename(originalName, extension);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = cleanFilename(`${base || "document"}-${stamp}${extension || ""}`);
  const bucket = body.isDefault ? "defaults" : cleanPathPart(body.entryKey || body.entryId || "unassigned");
  const targetDir = body.isDefault ? path.join(defaultsDir, cleanPathPart(type)) : path.join(uploadsDir, bucket);
  const targetPath = path.join(targetDir, filename);

  await mkdir(targetDir, { recursive: true });
  await writeFile(targetPath, Buffer.from(match[2], "base64"));

  sendJson(response, {
    id: body.id || randomUUID(),
    type,
    name: originalName,
    size: Number(body.size || 0),
    mime: body.mime || match[1] || "application/octet-stream",
    url: body.isDefault ? `/uploads/defaults/${cleanPathPart(type)}/${filename}` : `/uploads/${bucket}/${filename}`,
    path: targetPath,
    textPreview: String(body.textPreview || "").slice(0, 30000),
    isDefault: Boolean(body.isDefault),
    sourceDefaultId: body.sourceDefaultId || "",
    addedAt: body.addedAt || new Date().toISOString(),
  });
}

// Serve only app files. The data folder is blocked here and exposed only through safe routes.
async function serveStatic(pathname, response) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(rootDir, decodeURIComponent(safePath));
  if (!isInside(filePath, rootDir) || filePath.includes(`${path.sep}data${path.sep}`)) {
    return sendText(response, "Not found", 404);
  }
  return streamFile(filePath, response);
}

// Upload URLs are virtual paths mapped back into TRACKER_DATA_DIR.
async function serveUpload(pathname, response) {
  const decoded = decodeURIComponent(pathname);
  const filePath = decoded.startsWith("/uploads/defaults/")
    ? path.join(defaultsDir, decoded.replace("/uploads/defaults/", ""))
    : path.join(uploadsDir, decoded.replace("/uploads/", ""));
  if (!isInside(filePath, uploadsDir) && !isInside(filePath, defaultsDir)) {
    return sendText(response, "Not found", 404);
  }
  return streamFile(filePath, response, true);
}

// Helpers below are deliberately dependency-free to keep setup simple for new contributors.
async function streamFile(filePath, response, attachment = false) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return sendText(response, "Not found", 404);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(ext) || "application/octet-stream",
      ...(attachment ? { "Content-Disposition": `attachment; filename="${path.basename(filePath).replaceAll('"', "")}"` } : {}),
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, "Not found", 404);
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function stripDataUrlsFromEntry(entry) {
  return {
    ...entry,
    documents: Array.isArray(entry.documents) ? entry.documents.map(stripDataUrl) : [],
  };
}

function stripDataUrl(doc) {
  const { dataUrl, ...rest } = doc || {};
  return rest;
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function sendText(response, text, status = 200) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function cleanText(value) {
  return String(value || "Document").replace(/[^\w\s-]/g, "").trim() || "Document";
}

function cleanFilename(value) {
  return String(value || "document").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim() || "document";
}

function cleanPathPart(value) {
  return cleanText(value).replace(/\s+/g, "-").slice(0, 80) || "unassigned";
}

function isInside(filePath, parent) {
  const relative = path.relative(parent, filePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
