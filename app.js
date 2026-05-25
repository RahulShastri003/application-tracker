/*
  Application Tracker frontend logic.
  This file owns browser-side state, rendering, forms, import/export, uploads, and the local assistant.
  The backend API lives in server.mjs.
*/

// Configuration shared across the dashboard, editor, import/export, and local assistant.
const statuses = ["Not Submitted", "Submitted", "Interview", "Waiting", "Accepted", "Rejected"];
const applicationTypes = {
  postdoc: {
    label: "Postdoc",
    jobNameLabel: "Postdoc job name",
    jobNamePlaceholder: "e.g. Quantum thermodynamics postdoc",
    piNameLabel: "PI / contact",
    piNamePlaceholder: "Name, email, lab website",
    institutionLabel: "Institution / group",
    groupSectionTitle: "Group Information",
    groupInfoLabel: "Group information brief",
    jobSectionTitle: "Postdoc Information",
    jobBriefLabel: "Postdoc information brief",
    typeSpecificTitle: "Postdoc Details",
    typeSpecificDescription: "Fields that are usually useful for postdoctoral applications.",
    fields: [
      { id: "contractLength", label: "Contract length / start date", placeholder: "Duration, start window, renewal, funding source..." },
      { id: "researchFit", label: "Research fit", placeholder: "Why your background fits this PI/group/project..." },
      { id: "methodsToHighlight", label: "Methods to highlight", placeholder: "Techniques, theory, coding, experiments, publications..." },
      { id: "mobilityVisaNotes", label: "Mobility / visa notes", placeholder: "Relocation, work permit, family constraints, travel..." },
    ],
  },
  phd: {
    label: "PhD",
    jobNameLabel: "PhD program / project",
    jobNamePlaceholder: "e.g. PhD in quantum information",
    piNameLabel: "Supervisor / program contact",
    piNamePlaceholder: "Supervisor, admissions contact, program email...",
    institutionLabel: "University / department",
    groupSectionTitle: "Supervisor / Program Information",
    groupInfoLabel: "Supervisor or program information brief",
    jobSectionTitle: "PhD Information",
    jobBriefLabel: "Program / project information brief",
    typeSpecificTitle: "PhD Details",
    typeSpecificDescription: "Fields that are usually useful for PhD applications.",
    fields: [
      { id: "programRequirements", label: "Program requirements", placeholder: "Transcripts, English tests, application portal, required forms..." },
      { id: "fundingNotes", label: "Funding notes", placeholder: "Scholarship, stipend, tuition waiver, assistantship, external funding..." },
      { id: "sopFocus", label: "Statement of purpose focus", placeholder: "Research story, motivation, supervisor fit, program fit..." },
      { id: "recommendationPlan", label: "Recommendation plan", placeholder: "Who to ask, deadlines, portal instructions..." },
    ],
  },
  fellowship: {
    label: "Fellowship",
    jobNameLabel: "Fellowship name",
    jobNamePlaceholder: "e.g. Marie Curie Postdoctoral Fellowship",
    piNameLabel: "Host / sponsor contact",
    piNamePlaceholder: "Host PI, mentor, sponsor, program officer...",
    institutionLabel: "Host institution / program",
    groupSectionTitle: "Host / Program Information",
    groupInfoLabel: "Host or program information brief",
    jobSectionTitle: "Fellowship Information",
    jobBriefLabel: "Fellowship information brief",
    typeSpecificTitle: "Fellowship Details",
    typeSpecificDescription: "Fields that are usually useful for fellowships and academic awards.",
    fields: [
      { id: "eligibility", label: "Eligibility", placeholder: "Career stage, nationality, mobility rule, degree date, host limits..." },
      { id: "proposalIdea", label: "Proposal idea", placeholder: "Project title, aims, novelty, work packages..." },
      { id: "hostCommitments", label: "Host commitments", placeholder: "Letters, resources, supervision, institutional support..." },
      { id: "reviewCriteria", label: "Review criteria", placeholder: "Evaluation categories, scoring, priorities, fit..." },
    ],
  },
  grant: {
    label: "Grant",
    jobNameLabel: "Grant / call name",
    jobNamePlaceholder: "e.g. Early Career Research Grant",
    piNameLabel: "Program officer / collaborator",
    piNamePlaceholder: "Program officer, collaborator, institutional contact...",
    institutionLabel: "Funder / host institution",
    groupSectionTitle: "Funder / Host Information",
    groupInfoLabel: "Funder or host information brief",
    jobSectionTitle: "Grant Information",
    jobBriefLabel: "Grant information brief",
    typeSpecificTitle: "Grant Details",
    typeSpecificDescription: "Fields that are usually useful for grants and project funding calls.",
    fields: [
      { id: "budgetNotes", label: "Budget notes", placeholder: "Salary, equipment, travel, indirect costs, limits..." },
      { id: "proposalSections", label: "Proposal sections", placeholder: "Aims, impact, methods, timeline, dissemination..." },
      { id: "eligibility", label: "Eligibility", placeholder: "Applicant rules, institution rules, career stage, topic limits..." },
      { id: "internalDeadline", label: "Internal deadline / approvals", placeholder: "Department, grants office, host approvals, signatures..." },
    ],
  },
};
const storageKey = "postdoc-application-tracker-v1";
const masterStorageKey = "postdoc-application-master-files-v1";
const themeStorageKey = "application-tracker-theme";
const dismissedReminderStorageKey = "application-tracker-dismissed-reminders";
const maxFileBytes = 25 * 1024 * 1024;
let pdfLibPromise = null;
const fields = [
  "applicationType",
  "key",
  "jobName",
  "country",
  "deadline",
  "jobUrl",
  "piName",
  "institution",
  "groupInfo",
  "jobBrief",
  "keyPoints",
  "cvChanges",
  "referenceLetters",
  "papersToRead",
  "otherPreparation",
  "submittedDate",
  "followUpDate",
  "statusNotes",
];

const $ = (id) => document.getElementById(id);

// Runtime state. The backend is preferred, while localStorage remains a fallback and migration source.
let serverStorage = {
  ready: false,
  dataPath: "",
  uploadsPath: "",
};
let persistTimer = null;
let entries = [];
let masterDocuments = [];
let lastAiAnswerText = "";
let aiChatHistory = [];
let aiCooldownUntil = 0;
let aiRequestInFlight = false;
let aiSettings = {
  provider: "",
  configured: false,
  hasApiKey: false,
  baseUrl: "",
  model: "",
};

let selectedId = null;
let activeStatus = "Not Submitted";
let mode = "dashboard";
let draftDocuments = [];
let draftTypeDetails = {};
let pendingDeleteId = null;
let selectedEntryIds = new Set();
let entriesPage = 1;
const entriesPerPage = 20;
let pendingBulkDelete = false;
let dismissedReminderIds = loadDismissedReminderIds();

// Data model helpers keep entries/documents consistent across imports, edits, and older saved versions.
function createBlankEntry() {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    applicationType: "postdoc",
    key: "",
    jobName: "",
    country: "",
    deadline: "",
    deadlineReminder: false,
    jobUrl: "",
    piName: "",
    institution: "",
    groupInfo: "",
    jobBrief: "",
    keyPoints: "",
    cvChanges: "",
    referenceLetters: "",
    papersToRead: "",
    otherPreparation: "",
    submittedDate: "",
    followUpDate: "",
    followUpReminder: false,
    statusNotes: "",
    typeDetails: {},
    documents: [],
    status: "Not Submitted",
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeEntry(entry) {
  const base = createBlankEntry();
  const migratedStatus = entry.status === "Not Started" ? "Not Submitted" : entry.status;
  const status = statuses.includes(migratedStatus) ? migratedStatus : "Not Submitted";
  const applicationType = applicationTypes[entry.applicationType] ? entry.applicationType : "postdoc";
  return {
    ...base,
    ...entry,
    applicationType,
    status,
    deadlineReminder: booleanFrom(entry.deadlineReminder),
    followUpReminder: booleanFrom(entry.followUpReminder),
    typeDetails: entry.typeDetails && typeof entry.typeDetails === "object" ? entry.typeDetails : {},
    documents: Array.isArray(entry.documents) ? entry.documents.map(normalizeDocument) : [],
    createdAt: entry.createdAt || entry.updatedAt || base.createdAt,
    updatedAt: entry.updatedAt || base.updatedAt,
  };
}

function normalizeDocument(doc) {
  return {
    ...doc,
    type: doc.type === "Resume" ? "CV" : doc.type,
  };
}

function booleanFrom(value) {
  if (typeof value === "boolean") return value;
  const text = String(value || "").trim().toLowerCase();
  return ["true", "yes", "1", "on"].includes(text);
}

function applicationTypeConfig(type) {
  return applicationTypes[type] || applicationTypes.postdoc;
}

function applicationTypeLabel(type) {
  return applicationTypeConfig(type).label;
}

function cleanDocumentForStorage(doc) {
  const copy = { ...doc };
  delete copy.dataUrl;
  return copy;
}

function cleanEntryForStorage(entry) {
  return {
    ...entry,
    documents: Array.isArray(entry.documents) ? entry.documents.map(cleanDocumentForStorage) : [],
  };
}

function loadEntries() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(storageKey, JSON.stringify(entries));
  queueServerPersist();
}

function loadMasterDocuments() {
  try {
    const saved = JSON.parse(localStorage.getItem(masterStorageKey) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function persistMasterDocuments() {
  localStorage.setItem(masterStorageKey, JSON.stringify(masterDocuments));
  queueServerPersist();
}

// Storage bridge: reads/writes the local Node server when available.
async function initializeApp() {
  const localEntries = loadEntries().map(normalizeEntry);
  const localMasters = loadMasterDocuments().map(normalizeDocument);
  const serverState = await tryLoadServerState();
  if (serverState) {
    serverStorage = {
      ready: true,
      dataPath: serverState.dataPath || "",
      uploadsPath: serverState.uploadsPath || "",
    };
    entries = Array.isArray(serverState.entries) ? serverState.entries.map(normalizeEntry) : [];
    masterDocuments = Array.isArray(serverState.masterDocuments) ? serverState.masterDocuments.map(normalizeDocument) : [];
    if (!entries.length && localEntries.length) {
      await migrateLocalStateToServer(localEntries, localMasters);
    }
  } else {
    entries = localEntries;
    masterDocuments = localMasters;
  }
  await loadAiSettings();
  updateStorageLabels();
  renderAll();
}

async function tryLoadServerState() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function migrateLocalStateToServer(localEntries, localMasters) {
  const migratedEntries = [];
  for (const entry of localEntries) {
    const migrated = normalizeEntry(entry);
    migrated.documents = [];
    for (const doc of entry.documents || []) {
      migrated.documents.push(await uploadDocumentRecord(normalizeDocument(doc), { entry: migrated }));
    }
    migratedEntries.push(migrated);
  }
  const migratedMasters = [];
  for (const doc of localMasters) {
    migratedMasters.push(await uploadDocumentRecord(normalizeDocument(doc), { isDefault: true }));
  }
  entries = migratedEntries;
  masterDocuments = migratedMasters;
  await saveStateToServer();
  localStorage.setItem(storageKey, JSON.stringify(entries));
  localStorage.setItem(masterStorageKey, JSON.stringify(masterDocuments));
}

function queueServerPersist() {
  if (!serverStorage.ready) return;
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    saveStateToServer().catch((error) => {
      console.warn("Could not save to local folder storage", error);
      updateStorageLabels("Folder save failed. Browser copy is still updated.");
    });
  }, 150);
}

async function saveStateToServer() {
  if (!serverStorage.ready) return;
  const response = await fetch("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entries: entries.map(cleanEntryForStorage),
      masterDocuments: masterDocuments.map(cleanDocumentForStorage),
    }),
  });
  if (!response.ok) throw new Error("Could not save tracker state");
  updateStorageLabels();
}

function updateStorageLabels(message = "") {
  const storageText = serverStorage.ready
    ? `Saved to local folder: ${serverStorage.dataPath || "postdoc-tracker/data/applications.json"}`
    : "Saved in this browser. Start the local server to save into folders.";
  if ($("savedState")) $("savedState").textContent = message || storageText;
  if ($("fileStorageHint")) {
    $("fileStorageHint").textContent = serverStorage.ready
      ? `Files are saved as local files in: ${serverStorage.uploadsPath || "postdoc-tracker/data/uploads"}`
      : "Files are stored inside this browser only. Start the local server for folder storage.";
  }
  if ($("footerStorageHint")) {
    $("footerStorageHint").textContent = serverStorage.ready
      ? "Attachments and edits are saved in the local tracker folder after saving."
      : "Attachments and edits are kept in this browser after saving.";
  }
}

async function loadAiSettings() {
  try {
    const response = await fetch("/api/ai/settings", { cache: "no-store" });
    if (!response.ok) throw new Error("AI settings unavailable");
    aiSettings = await response.json();
    renderAiSettings();
  } catch {
    aiSettings = { provider: "", configured: false, hasApiKey: false, baseUrl: "", model: "" };
    renderAiSettings("Local assistant only. Start the local server to save AI provider settings.");
  }
}

function renderAiSettings(message = "") {
  if (!$("aiProvider")) return;
  $("aiProvider").value = aiSettings.provider || "";
  $("aiBaseUrl").value = aiSettings.baseUrl || "";
  $("aiModel").value = aiSettings.model || "";
  $("aiApiKey").value = "";
  updateAiProviderUi({ preserveValues: true });
  $("aiSettingsStatus").textContent =
    message ||
    (aiSettings.configured
      ? `Connected settings saved for ${aiProviderLabel(aiSettings.provider)} using ${aiSettings.model}${aiSettings.hasApiKey ? " with an API key." : " without an API key."}`
      : "Local assistant only. Choose a provider only when you want to connect an external model.");
  updateAiButtonStates();
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
    ollama: "http://localhost:11434/v1",
    groq: "https://api.groq.com/openai/v1",
    openrouter: "https://openrouter.ai/api/v1",
    mistral: "https://api.mistral.ai/v1",
  }[provider] || "";
}

function aiProviderLabel(provider) {
  if (!provider) return "Local assistant";
  return {
    gemini: "Gemini API",
    ollama: "Ollama local model",
    groq: "Groq API",
    openrouter: "OpenRouter API",
    mistral: "Mistral API",
  }[provider] || "Custom OpenAI-compatible provider";
}

function updateAiProviderUi(options = {}) {
  const provider = $("aiProvider").value;
  const providerBaseUrl = defaultAiBaseUrl(provider);
  const providerModel = defaultAiModel(provider);
  const external = Boolean(provider);
  const apiKeyNeeded = external && provider !== "ollama";
  $("aiBaseUrlField").classList.toggle("hidden", !external || provider === "gemini");
  $("aiModel").disabled = !external;
  $("aiApiKey").disabled = !apiKeyNeeded;
  $("aiBaseUrl").disabled = !external || provider === "gemini";
  if (!options.preserveValues) {
    $("aiModel").value = providerModel;
    $("aiBaseUrl").value = providerBaseUrl;
    $("aiApiKey").value = "";
  }
  if (provider === "gemini") {
    $("aiModel").placeholder = "gemini-2.5-flash";
    $("aiSettingsStatus").textContent = "Gemini selected. Add your own API key to use it.";
    $("aiProviderHint").textContent = "Gemini uses Google AI Studio keys. Base URL is handled by the app.";
  } else if (provider === "ollama") {
    $("aiModel").placeholder = "qwen2.5:0.5b";
    $("aiSettingsStatus").textContent = "Ollama selected. Run Ollama locally, pull a model, then save settings.";
    $("aiProviderHint").textContent = "Ollama URL: http://localhost:11434/v1. No API key needed.";
  } else if (["groq", "openrouter", "mistral"].includes(provider)) {
    $("aiModel").placeholder = providerModel || "Model name from provider";
    $("aiSettingsStatus").textContent = `${aiProviderLabel(provider)} selected. Add your own API key.`;
    $("aiProviderHint").textContent = `Default URL: ${providerBaseUrl}`;
  } else if (provider === "openai-compatible") {
    $("aiModel").placeholder = "Model name from your provider";
    $("aiSettingsStatus").textContent = "Custom provider selected. Add a base URL and model name.";
    $("aiProviderHint").textContent = "Examples: http://localhost:1234/v1, https://api.openai.com/v1, or another compatible endpoint.";
  } else {
    $("aiModel").placeholder = "No model needed";
    $("aiModel").value = "";
    $("aiBaseUrl").value = "";
    $("aiApiKey").value = "";
    $("aiSettingsStatus").textContent = "Local assistant only. No external API will be called.";
    $("aiProviderHint").textContent = "Local assistant uses no external model.";
  }
  updateAiButtonStates();
}

async function saveAiSettings(options = {}) {
  try {
    const provider = $("aiProvider").value;
    const apiKeyNeeded = Boolean(provider) && provider !== "ollama";
    const baseUrlNeeded = Boolean(provider) && provider !== "gemini";
    const model = provider ? ($("aiModel").value.trim() || defaultAiModel(provider)) : "";
    const baseUrl = baseUrlNeeded ? ($("aiBaseUrl").value.trim() || defaultAiBaseUrl(provider)) : "";
    const typedApiKey = $("aiApiKey").value.trim();
    const clearApiKey = Boolean(options.clearApiKey) || !apiKeyNeeded;
    const sameProviderHasKey = aiSettings.provider === provider && aiSettings.hasApiKey;

    if (provider && !model) {
      $("aiSettingsStatus").textContent = "Choose or enter a model before saving AI settings.";
      $("aiModel").focus();
      return;
    }
    if (baseUrlNeeded && !baseUrl) {
      $("aiSettingsStatus").textContent = "Enter the provider API URL before saving AI settings.";
      $("aiBaseUrl").focus();
      return;
    }
    if (apiKeyNeeded && !typedApiKey && !sameProviderHasKey && !options.clearApiKey) {
      $("aiSettingsStatus").textContent = "Paste your own API key before saving this provider.";
      $("aiApiKey").focus();
      return;
    }

    $("aiSettingsStatus").textContent = "Saving AI settings...";
    $("saveAiSettings").disabled = true;
    $("clearAiKey").disabled = true;
    const response = await fetch("/api/ai/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        baseUrl,
        model,
        apiKey: typedApiKey,
        clearApiKey,
      }),
    });
    if (!response.ok) {
      throw new Error(response.status === 404 ? "The backend server is outdated. Restart the tracker server, then reload the browser." : "Could not save AI settings");
    }
    aiSettings = await response.json();
    renderAiSettings(options.clearApiKey ? "Saved API key cleared." : "AI settings saved locally.");
  } catch (error) {
    console.warn("AI settings save failed", error);
    $("aiSettingsStatus").textContent = error.message || "Could not save AI settings. Make sure the local server is running.";
    updateAiButtonStates();
  } finally {
    $("saveAiSettings").disabled = false;
    updateAiButtonStates();
  }
}

async function clearSavedAiKey() {
  $("aiApiKey").value = "";
  if (!aiSettings.hasApiKey) {
    $("aiSettingsStatus").textContent = "No saved API key is stored for the current provider.";
    updateAiButtonStates();
    return;
  }
  await saveAiSettings({ clearApiKey: true });
}

function updateAiButtonStates() {
  if (!$("askAi")) return;
  $("askAi").disabled = aiRequestInFlight;
  $("clearAiKey").disabled = aiRequestInFlight || !aiSettings.hasApiKey;
  $("clearAiKey").textContent = aiSettings.hasApiKey ? "Clear Key" : "No Key Stored";
}

function selectedEntry() {
  return entries.find((entry) => entry.id === selectedId) || null;
}

// Dashboard filtering and sorting.
function setMode(nextMode) {
  mode = nextMode;
  const editing = mode === "edit" || mode === "new";
  document.querySelector(".filters").classList.toggle("hidden", editing);
  $("stats").classList.toggle("hidden", editing);
  $("entriesPanel").classList.toggle("hidden", editing);
  $("aiPanel").classList.toggle("hidden", editing || $("aiPanel").dataset.open !== "true");
  $("notificationPanel").classList.toggle("hidden", editing || $("notificationPanel").dataset.open !== "true");
  $("formPanel").classList.toggle("hidden", mode !== "edit" && mode !== "new");
}

function statusClass(status) {
  return `status-${status.toLowerCase().replaceAll(" ", "-")}`;
}

function searchableText(entry) {
  return [
    applicationTypeLabel(entry.applicationType),
    entry.key,
    entry.jobName,
    entry.country,
    entry.deadline,
    entry.piName,
    entry.institution,
    entry.groupInfo,
    entry.jobBrief,
    entry.keyPoints,
    entry.cvChanges,
    entry.referenceLetters,
    entry.papersToRead,
    entry.otherPreparation,
    entry.status,
    entry.statusNotes,
    ...Object.values(entry.typeDetails || {}),
    ...(entry.documents || []).map((doc) => `${doc.type} ${doc.name}`),
  ]
    .join(" ")
    .toLowerCase();
}

function filteredEntries() {
  const query = $("search").value.trim().toLowerCase();
  const status = $("statusFilter").value;
  const deadline = $("deadlineFilter").value;
  const sortBy = $("sortBy").value;
  const today = startOfToday();

  let result = entries.filter((entry) => {
    const statusMatch = status === "all" || entry.status === status;
    const queryMatch = !query || searchableText(entry).includes(query);
    let deadlineMatch = true;
    if (deadline === "upcoming") deadlineMatch = !!entry.deadline && new Date(entry.deadline) >= today;
    if (deadline === "overdue") deadlineMatch = !!entry.deadline && new Date(entry.deadline) < today;
    if (deadline === "none") deadlineMatch = !entry.deadline;
    return statusMatch && queryMatch && deadlineMatch;
  });

  result.sort((a, b) => {
    if (sortBy === "deadline") {
      return dateRank(a.deadline) - dateRank(b.deadline);
    }
    if (sortBy === "added") return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    if (sortBy === "status") return statuses.indexOf(a.status) - statuses.indexOf(b.status);
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
  return result;
}

function renderFilters() {
  const current = $("statusFilter").value || "all";
  $("statusFilter").innerHTML = `<option value="all">All statuses</option>${statuses
    .map((status) => `<option value="${status}">${status}</option>`)
    .join("")}`;
  $("statusFilter").value = current;
}

// Dashboard rendering and accordion summaries.
function renderStats() {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
  entries.forEach((entry) => {
    counts[entry.status] += 1;
  });
  const active = entries.filter((entry) => !["Accepted", "Rejected"].includes(entry.status)).length;
  const stats = [
    ["Total", entries.length],
    ["Active", active],
    ["Submitted", counts.Submitted],
    ["Interview", counts.Interview],
    ["Waiting", counts.Waiting],
    ["Accepted", counts.Accepted],
  ];
  $("stats").innerHTML = stats
    .map(
      ([label, value]) =>
        `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`,
    )
    .join("");
}

function notificationItems() {
  const today = startOfToday();
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 14);
  const items = [];

  entries.forEach((entry) => {
    if (["Accepted", "Rejected"].includes(entry.status)) return;
    if (entry.deadline && entry.deadlineReminder) {
      const deadline = new Date(entry.deadline);
      if (deadline < today) {
        items.push({
          id: reminderId(entry, "deadline"),
          level: "overdue",
          entryId: entry.id,
          title: `${entry.key || "AUTO"} deadline has passed`,
          meta: `${entry.jobName || "Untitled application"} - ${formatDate(entry.deadline)} - ${entry.status}`,
        });
      } else if (deadline <= soon) {
        items.push({
          id: reminderId(entry, "deadline"),
          level: "warning",
          entryId: entry.id,
          title: `${entry.key || "AUTO"} deadline is coming up`,
          meta: `${entry.jobName || "Untitled application"} - ${formatDate(entry.deadline)} - ${entry.status}`,
        });
      }
    }
    if (entry.followUpDate && entry.followUpReminder && ["Submitted", "Waiting", "Interview"].includes(entry.status)) {
      const followUp = new Date(entry.followUpDate);
      if (followUp <= today) {
        items.push({
          id: reminderId(entry, "followup"),
          level: "warning",
          entryId: entry.id,
          title: `${entry.key || "AUTO"} follow-up is due`,
          meta: `${entry.jobName || "Untitled application"} - ${formatDate(entry.followUpDate)} - ${entry.status}`,
        });
      }
    }
    if (entry.status === "Not Submitted" && entry.deadline && entry.deadlineReminder) {
      const deadline = new Date(entry.deadline);
      if (deadline >= today && deadline <= soon) {
        items.push({
          id: reminderId(entry, "deadline"),
          level: "warning",
          entryId: entry.id,
          title: `${entry.key || "AUTO"} is not submitted yet`,
          meta: `${entry.jobName || "Untitled application"} - deadline ${formatDate(entry.deadline)}`,
        });
      }
    }
  });

  const unique = new Map();
  items.forEach((item) => {
    if (!dismissedReminderIds.has(item.id)) unique.set(item.id, item);
  });
  return [...unique.values()].slice(0, 12);
}

function renderNotifications() {
  const items = notificationItems();
  $("notificationCount").textContent = String(items.length);
  $("notificationCount").classList.toggle("hidden", !items.length);
  $("notificationList").innerHTML = items.length
    ? `<div class="notification-list">${items
        .map(
          (item) => `
            <button class="notification-item ${item.level}" type="button" data-notification-entry="${item.entryId}" data-notification-id="${item.id}">
              <span class="notification-title">${escapeHtml(item.title)}</span>
              <span class="notification-meta">${escapeHtml(item.meta)}</span>
            </button>
          `,
        )
        .join("")}</div>`
    : `<div class="empty">No deadline or follow-up reminders right now.</div>`;

  document.querySelectorAll("[data-notification-entry]").forEach((button) => {
    button.addEventListener("click", () => {
      dismissedReminderIds.add(button.dataset.notificationId);
      saveDismissedReminderIds();
      selectedId = button.dataset.notificationEntry;
      $("notificationPanel").dataset.open = "false";
      setMode("dashboard");
      renderNotifications();
      renderEntries();
      $("entriesPanel").scrollIntoView({ block: "start", behavior: "smooth" });
    });
  });
}

function reminderId(entry, type) {
  const date = type === "followup" ? entry.followUpDate : entry.deadline;
  return `${type}:${entry.id}:${date || "none"}:${entry.status}`;
}

function loadDismissedReminderIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(dismissedReminderStorageKey) || "[]"));
  } catch {
    return new Set();
  }
}

function saveDismissedReminderIds() {
  localStorage.setItem(dismissedReminderStorageKey, JSON.stringify([...dismissedReminderIds].slice(-300)));
}

function toggleNotifications() {
  const next = $("notificationPanel").dataset.open !== "true";
  $("notificationPanel").dataset.open = String(next);
  if (next) $("aiPanel").dataset.open = "false";
  setMode("dashboard");
  renderNotifications();
}

function renderEntries() {
  const items = filteredEntries();
  pruneSelectedEntries();
  const totalPages = Math.max(1, Math.ceil(items.length / entriesPerPage));
  if (entriesPage > totalPages) entriesPage = totalPages;
  const pageStart = (entriesPage - 1) * entriesPerPage;
  const pageItems = items.slice(pageStart, pageStart + entriesPerPage);
  const pageIds = pageItems.map((entry) => entry.id);
  const pageSelected = pageIds.length > 0 && pageIds.every((id) => selectedEntryIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedEntryIds.has(id));
  if (!items.length) {
    $("entriesTableWrap").innerHTML = `<div class="empty">No matching applications. Clear filters or add a new entry.</div>`;
    return;
  }

  $("entriesTableWrap").innerHTML = `
    ${renderEntriesToolbar(items, pageStart, pageItems.length, totalPages, pageSelected, somePageSelected)}
    <table class="entries-table">
      <thead>
        <tr>
          <th class="select-cell">
            <input type="checkbox" data-select-page ${pageSelected ? "checked" : ""} ${somePageSelected && !pageSelected ? "data-mixed=\"true\"" : ""} aria-label="Select all entries on this page" />
          </th>
          <th>Key</th>
          <th>Opportunity</th>
          <th>Status</th>
          <th>Deadline</th>
          <th>Country / city</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        ${pageItems
          .map(
            (entry) => `
              <tr class="entry-row ${entry.id === selectedId ? "expanded" : ""}" data-entry-id="${entry.id}">
                <td class="select-cell">
                  <input type="checkbox" data-select-entry="${entry.id}" ${selectedEntryIds.has(entry.id) ? "checked" : ""} aria-label="Select ${escapeHtml(entry.key || entry.jobName || "entry")}" />
                </td>
                <td><span class="key">${escapeHtml(entry.key || "AUTO")}</span></td>
                <td>
                  <div class="job-name">${escapeHtml(entry.jobName || `Untitled ${applicationTypeLabel(entry.applicationType)} application`)}</div>
                  <div class="muted">${escapeHtml(applicationTypeLabel(entry.applicationType))}${entry.institution || entry.piName ? ` | ${escapeHtml(entry.institution || entry.piName)}` : ""}</div>
                </td>
                <td><span class="badge ${statusClass(entry.status)}">${escapeHtml(entry.status)}</span></td>
                <td>${escapeHtml(entry.deadline ? formatDate(entry.deadline) : "No deadline")}</td>
                <td>${escapeHtml(entry.country || "Not set")}</td>
                <td>${escapeHtml(formatDateTime(entry.updatedAt))}</td>
              </tr>
              ${entry.id === selectedId ? renderEntrySummary(entry) : ""}
            `,
          )
          .join("")}
      </tbody>
    </table>
    ${renderPagination(items.length, pageStart, pageItems.length, totalPages)}
  `;

  document.querySelectorAll("[data-select-page]").forEach((checkbox) => {
    checkbox.indeterminate = somePageSelected && !pageSelected;
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePageSelection(pageIds, checkbox.checked);
    });
  });
  document.querySelectorAll("[data-select-entry]").forEach((checkbox) => {
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleEntrySelection(checkbox.dataset.selectEntry, checkbox.checked);
    });
  });
  document.querySelectorAll("[data-delete-selected]").forEach((button) => {
    button.addEventListener("click", () => deleteSelectedEntries(button));
  });
  document.querySelectorAll("[data-clear-selection]").forEach((button) => {
    button.addEventListener("click", clearEntrySelection);
  });
  document.querySelectorAll("[data-page-prev]").forEach((button) => {
    button.addEventListener("click", () => changeEntriesPage(entriesPage - 1));
  });
  document.querySelectorAll("[data-page-next]").forEach((button) => {
    button.addEventListener("click", () => changeEntriesPage(entriesPage + 1));
  });
  document.querySelectorAll("[data-entry-id]").forEach((row) => {
    row.addEventListener("click", () => openEntry(row.dataset.entryId));
  });
  document.querySelectorAll("[data-edit-entry]").forEach((button) => {
    button.addEventListener("click", () => startEdit(button.dataset.editEntry));
  });
  document.querySelectorAll("[data-copy-entry]").forEach((button) => {
    button.addEventListener("click", () => copyEntryDetails(button.dataset.copyEntry));
  });
  document.querySelectorAll("[data-duplicate-entry]").forEach((button) => {
    button.addEventListener("click", () => duplicateEntry(button.dataset.duplicateEntry));
  });
  document.querySelectorAll("[data-delete-entry]").forEach((button) => {
    button.addEventListener("click", () => deleteFromSummary(button.dataset.deleteEntry, button));
  });
}

function renderEntriesToolbar(items, pageStart, pageCount, totalPages, pageSelected, somePageSelected) {
  const total = items.length;
  const selectedCount = selectedEntryIds.size;
  return `
    <div class="entries-toolbar">
      <label class="select-page-control">
        <input type="checkbox" data-select-page ${pageSelected ? "checked" : ""} ${somePageSelected && !pageSelected ? "data-mixed=\"true\"" : ""} />
        Select all on page
      </label>
      <span class="saved">${selectedCount ? `${selectedCount} selected` : rangeText(total, pageStart, pageCount)}</span>
      <button class="btn ${selectedCount ? "" : "hidden"}" type="button" data-clear-selection>
        Clear Selection
      </button>
      <button class="btn danger ${selectedCount ? "" : "hidden"}" type="button" data-delete-selected>
        ${pendingBulkDelete ? `Confirm Delete ${selectedCount}` : `Delete Selected`}
      </button>
      <span class="entries-page-status">${rangeText(total, pageStart, pageCount)}${totalPages > 1 ? `, page ${entriesPage} of ${totalPages}` : ""}</span>
    </div>
  `;
}

function renderPagination(total, pageStart, pageCount, totalPages) {
  return `
    <div class="entries-pagination">
      <span class="saved">${rangeText(total, pageStart, pageCount)}</span>
      <div class="panel-actions">
        <button class="btn" type="button" data-page-prev ${entriesPage <= 1 ? "disabled" : ""} aria-label="Previous page">&lt; Previous</button>
        <button class="btn" type="button" data-page-next ${entriesPage >= totalPages ? "disabled" : ""} aria-label="Next page">Next &gt;</button>
      </div>
    </div>
  `;
}

function rangeText(total, pageStart, pageCount) {
  if (!total) return "0 entries";
  return `${pageStart + 1}-${pageStart + pageCount} of ${total}`;
}

function pruneSelectedEntries() {
  const existing = new Set(entries.map((entry) => entry.id));
  selectedEntryIds = new Set([...selectedEntryIds].filter((id) => existing.has(id)));
}

function togglePageSelection(ids, checked) {
  pendingBulkDelete = false;
  ids.forEach((id) => {
    if (checked) selectedEntryIds.add(id);
    else selectedEntryIds.delete(id);
  });
  renderEntries();
}

function toggleEntrySelection(id, checked) {
  pendingBulkDelete = false;
  if (checked) selectedEntryIds.add(id);
  else selectedEntryIds.delete(id);
  renderEntries();
}

function clearEntrySelection() {
  pendingBulkDelete = false;
  selectedEntryIds = new Set();
  renderEntries();
}

function changeEntriesPage(nextPage) {
  entriesPage = Math.max(1, nextPage);
  pendingBulkDelete = false;
  selectedId = null;
  renderEntries();
}

function deleteSelectedEntries(button) {
  const count = selectedEntryIds.size;
  if (!count) return;
  if (!pendingBulkDelete) {
    pendingBulkDelete = true;
    button.textContent = `Confirm Delete ${count}`;
    $("dashboardHint").textContent = `Click Confirm Delete to remove ${count} selected entr${count === 1 ? "y" : "ies"}.`;
    return;
  }
  entries = entries.filter((entry) => !selectedEntryIds.has(entry.id));
  selectedEntryIds = new Set();
  pendingBulkDelete = false;
  pendingDeleteId = null;
  selectedId = null;
  persist();
  renderAll();
  $("dashboardHint").textContent = `${count} entr${count === 1 ? "y" : "ies"} deleted.`;
}

function openEntry(id) {
  pendingDeleteId = null;
  $("dashboardHint").textContent = "Click a row to expand or collapse its summary.";
  selectedId = selectedId === id ? null : id;
  setMode("dashboard");
  renderEntries();
}

function renderEntrySummary(entry) {
  const typeSummary = renderTypeSpecificSummary(entry);
  return `
    <tr class="summary-row">
      <td colspan="7" class="expand-cell">
        <div class="entry-summary">
          <div class="summary-head">
            <div class="muted">${escapeHtml(entry.institution || "Group not added")} ${entry.piName ? `| ${escapeHtml(entry.piName)}` : ""}</div>
            <div class="panel-actions">
              <button class="btn" type="button" data-copy-entry="${entry.id}">Copy Details</button>
              <button class="btn" type="button" data-duplicate-entry="${entry.id}">Copy Entry</button>
              <button class="btn primary" type="button" data-edit-entry="${entry.id}">Edit</button>
              <button class="btn danger" type="button" data-delete-entry="${entry.id}">Delete</button>
            </div>
          </div>
          <div class="summary-grid">
            ${summaryCard("Type", applicationTypeLabel(entry.applicationType))}
            ${summaryCard("Status", `<span class="badge ${statusClass(entry.status)}">${escapeHtml(entry.status)}</span>`, true)}
            ${summaryCard("Deadline", entry.deadline ? formatDate(entry.deadline) : "No deadline")}
            ${entry.status === "Submitted" || entry.status === "Waiting" ? summaryCard("Next follow-up", entry.followUpDate ? formatDate(entry.followUpDate) : "Not set") : summaryCard("Updated", formatDateTime(entry.updatedAt))}
          </div>
          <div class="summary-columns">
            <div class="summary-note">
              <span class="summary-label">Main job / group reminder</span>
              <span class="summary-value">${escapeHtml(compactText(entry.jobBrief || entry.groupInfo || entry.keyPoints || "No job or group summary added yet."))}</span>
            </div>
            <div class="summary-note">
              <span class="summary-label">Preparation reminder</span>
              <span class="summary-value">${escapeHtml(compactText(entry.cvChanges || entry.referenceLetters || entry.papersToRead || entry.otherPreparation || "No preparation notes added yet."))}</span>
            </div>
          </div>
          <div class="summary-columns">
            <div class="summary-note">
              <span class="summary-label">Papers / references</span>
              <span class="summary-value">${escapeHtml(compactText(entry.papersToRead || entry.referenceLetters || "No paper or reference notes added yet."))}</span>
            </div>
            <div class="summary-note">
              <span class="summary-label">${entry.status === "Not Submitted" ? "Next useful action" : "Status notes"}</span>
              <span class="summary-value">${escapeHtml(compactText(statusAwareReminder(entry)))}</span>
            </div>
          </div>
          <div class="summary-note">
            <span class="summary-label">Documents</span>
            <span class="summary-value">${escapeHtml(documentSummary(entry.documents || []))}</span>
          </div>
          ${
            typeSummary
              ? `<div class="summary-note">
                  <span class="summary-label">${escapeHtml(applicationTypeLabel(entry.applicationType))} details</span>
                  <span class="summary-value">${escapeHtml(typeSummary)}</span>
                </div>`
              : ""
          }
        </div>
      </td>
    </tr>
  `;
}

function renderTypeSpecificSummary(entry) {
  const details = entry.typeDetails || {};
  const values = applicationTypeConfig(entry.applicationType).fields
    .map((field) => {
      const value = compactText(details[field.id]);
      return value ? `${field.label}: ${value}` : "";
    })
    .filter(Boolean);
  return compactText(values.join(" | "));
}

function summaryCard(label, value, isHtml = false) {
  return `<div class="summary-card"><span class="summary-label">${escapeHtml(label)}</span><span class="summary-value">${isHtml ? value : escapeHtml(value)}</span></div>`;
}

function compactText(value) {
  const text = String(value || "").trim();
  return text.length > 380 ? `${text.slice(0, 377)}...` : text;
}

function documentSummary(documents) {
  if (!documents.length) return "No documents attached.";
  return documents.map((doc) => `${doc.type || "Document"}: ${doc.name || "Unnamed file"}`).join("; ");
}

function typeDetailsSummary(entry) {
  const details = entry.typeDetails || {};
  const configured = applicationTypeConfig(entry.applicationType).fields
    .map((field) => (details[field.id] ? `${field.label}: ${details[field.id]}` : ""))
    .filter(Boolean);
  const extra = Object.entries(details)
    .filter(([key, value]) => value && !applicationTypeConfig(entry.applicationType).fields.some((field) => field.id === key))
    .map(([key, value]) => `${key}: ${value}`);
  return [...configured, ...extra].join("; ");
}

function statusAwareReminder(entry) {
  if (entry.status === "Not Submitted") {
    return entry.cvChanges || entry.referenceLetters || entry.papersToRead || entry.otherPreparation || "Prepare materials, tailor CV, read papers, and request references before submission.";
  }
  if (entry.status === "Submitted") {
    return entry.statusNotes || (entry.followUpDate ? `Follow up on ${formatDate(entry.followUpDate)} if there is no response.` : "Application submitted. Add a follow-up date if needed.");
  }
  if (entry.status === "Waiting") {
    return entry.statusNotes || (entry.followUpDate ? `Waiting for response. Follow up on ${formatDate(entry.followUpDate)}.` : "Waiting for response. Add a follow-up date if useful.");
  }
  if (entry.status === "Interview") {
    return entry.statusNotes || "Prepare interview notes, questions for the PI, and project fit talking points.";
  }
  if (entry.status === "Accepted") return entry.statusNotes || "Accepted. Record offer details and next administrative steps.";
  if (entry.status === "Rejected") return entry.statusNotes || "Rejected. Record useful lessons or feedback.";
  return entry.statusNotes || "No status notes added yet.";
}

// Entry editor lifecycle: create, edit, duplicate, save, cancel, and delete.
function startEdit(id) {
  selectedId = id;
  const entry = selectedEntry();
  if (!entry) return;
  pendingDeleteId = null;
  activeStatus = entry.status;
  draftDocuments = structuredClone(entry.documents || []);
  writeForm(entry);
  $("formTitle").textContent = `Edit ${entry.key || entry.jobName || "Entry"}`;
  $("deleteEntry").textContent = "Delete";
  $("deleteEntryBottom").textContent = "Delete";
  $("deleteEntry").classList.remove("hidden");
  $("deleteEntryBottom").classList.remove("hidden");
  setMode("edit");
  $("formPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function startNewEntry() {
  pendingDeleteId = null;
  selectedId = crypto.randomUUID();
  activeStatus = "Not Submitted";
  draftDocuments = defaultDocumentCopies();
  writeForm({ ...createBlankEntry(), id: selectedId });
  $("formTitle").textContent = "New Entry";
  $("deleteEntry").textContent = "Delete";
  $("deleteEntryBottom").textContent = "Delete";
  $("deleteEntry").classList.add("hidden");
  $("deleteEntryBottom").classList.add("hidden");
  setMode("new");
  $("formPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  $("key").focus();
}

function duplicateEntry(id) {
  const source = entries.find((entry) => entry.id === id);
  if (!source) return;
  const now = new Date().toISOString();
  const copy = normalizeEntry({
    ...structuredClone(source),
    id: crypto.randomUUID(),
    key: source.key ? `${source.key}-COPY` : "",
    status: "Not Submitted",
    submittedDate: "",
    followUpDate: "",
    statusNotes: "",
    documents: structuredClone(source.documents || []).map((doc) => ({
      ...doc,
      id: crypto.randomUUID(),
      name: doc.name || "Copied document",
      addedAt: now,
    })),
    createdAt: now,
    updatedAt: now,
  });
  entries.unshift(copy);
  selectedId = copy.id;
  persist();
  startEdit(copy.id);
}

function writeForm(entry) {
  renderApplicationTypeOptions();
  fields.forEach((field) => {
    $(field).value = entry[field] || "";
  });
  $("deadlineReminder").checked = Boolean(entry.deadlineReminder);
  $("followUpReminder").checked = Boolean(entry.followUpReminder);
  draftTypeDetails = structuredClone(entry.typeDetails || {});
  updateApplicationTypeUi(entry.applicationType || "postdoc");
  activeStatus = entry.status || "Not Submitted";
  renderStatusButtons();
  renderFormDocs();
  renderDefaultFilesHint();
  updateStatusDateVisibility();
  $("savedState").textContent = `${serverStorage.ready ? "Folder-backed draft" : "Browser draft"}. Last saved: ${formatDateTime(entry.updatedAt)}`;
}

function readForm() {
  const entry = mode === "new" ? createBlankEntry() : normalizeEntry(selectedEntry() || {});
  entry.id = selectedId || entry.id;
  collectVisibleTypeDetails();
  fields.forEach((field) => {
    entry[field] = $(field).value.trim();
  });
  entry.deadlineReminder = $("deadlineReminder").checked;
  entry.followUpReminder = $("followUpReminder").checked;
  entry.applicationType = applicationTypes[entry.applicationType] ? entry.applicationType : "postdoc";
  entry.typeDetails = structuredClone(draftTypeDetails);
  entry.status = activeStatus;
  if (activeStatus === "Not Submitted") {
    entry.submittedDate = "";
    entry.followUpDate = "";
    entry.followUpReminder = false;
  }
  entry.documents = structuredClone(draftDocuments);
  entry.updatedAt = new Date().toISOString();
  if (!entry.createdAt) entry.createdAt = entry.updatedAt;
  entry.key = normalizeEntryKey(entry.key, entry.id);
  return normalizeEntry(entry);
}

function normalizeEntryKey(rawKey, currentEntryId = "") {
  const used = usedKeysFor(currentEntryId);
  const key = String(rawKey || "").trim();
  if (!key) return nextAvailableKey(currentEntryId);
  if (!used.has(key)) return key;
  return nextImportedKey(key, used);
}

function usedKeysFor(currentEntryId = "") {
  return new Set(
    entries
      .filter((entry) => entry.id !== currentEntryId)
      .map((entry) => String(entry.key || "").trim())
      .filter(Boolean),
  );
}

function nextAvailableKey(currentEntryId = "") {
  const used = usedKeysFor(currentEntryId);
  const usedKeys = [...used];
  const numericKeys = usedKeys
    .map((key) => Number(key))
    .filter((value) => Number.isInteger(value) && value > 0);
  let next = numericKeys.length ? Math.max(...numericKeys) + 1 : usedKeys.length + 1;
  let candidate = String(next).padStart(3, "0");
  while (used.has(candidate)) {
    next += 1;
    candidate = String(next).padStart(3, "0");
  }
  return candidate;
}

function renderApplicationTypeOptions() {
  $("applicationType").innerHTML = Object.entries(applicationTypes)
    .map(([value, config]) => `<option value="${value}">${config.label}</option>`)
    .join("");
}

function updateApplicationTypeUi(type) {
  const config = applicationTypeConfig(type);
  $("jobNameLabel").textContent = config.jobNameLabel;
  $("jobName").placeholder = config.jobNamePlaceholder;
  $("piNameLabel").textContent = config.piNameLabel;
  $("piName").placeholder = config.piNamePlaceholder;
  $("institutionLabel").textContent = config.institutionLabel;
  $("groupSectionTitle").textContent = config.groupSectionTitle;
  $("groupInfoLabel").textContent = config.groupInfoLabel;
  $("jobSectionTitle").textContent = config.jobSectionTitle;
  $("jobBriefLabel").textContent = config.jobBriefLabel;
  $("typeSpecificTitle").textContent = config.typeSpecificTitle;
  $("typeSpecificDescription").textContent = config.typeSpecificDescription;
  renderTypeSpecificFields(type);
}

function renderTypeSpecificFields(type) {
  const config = applicationTypeConfig(type);
  $("typeSpecificFields").innerHTML = config.fields
    .map(
      (field) => `
        <div class="field">
          <label for="typeDetail_${field.id}">${escapeHtml(field.label)}</label>
          <textarea id="typeDetail_${field.id}" data-type-detail="${field.id}" placeholder="${escapeHtml(field.placeholder)}">${escapeHtml(draftTypeDetails[field.id] || "")}</textarea>
        </div>
      `,
    )
    .join("");
  document.querySelectorAll("[data-type-detail]").forEach((input) => {
    input.addEventListener("input", () => {
      draftTypeDetails[input.dataset.typeDetail] = input.value.trim();
      $("savedState").textContent = "Unsaved changes.";
    });
  });
}

function collectVisibleTypeDetails() {
  document.querySelectorAll("[data-type-detail]").forEach((input) => {
    draftTypeDetails[input.dataset.typeDetail] = input.value.trim();
  });
}

function renderStatusButtons() {
  $("statusButtons").innerHTML = statuses
    .map(
      (status) =>
        `<button type="button" class="status-toggle ${status === activeStatus ? "selected" : ""}" data-status="${status}">${status}</button>`,
    )
    .join("");
  document.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      activeStatus = button.dataset.status;
      renderStatusButtons();
      updateStatusDateVisibility();
      $("savedState").textContent = "Unsaved status change.";
    });
  });
}

function updateStatusDateVisibility() {
  const canUseSubmissionDates = activeStatus !== "Not Submitted";
  const canUseFollowUp = ["Submitted", "Waiting"].includes(activeStatus);
  $("statusDateFields").classList.toggle("hidden", !canUseSubmissionDates);
  $("statusDateFields").classList.toggle("disabled", !canUseSubmissionDates);
  $("submittedDateField").classList.toggle("hidden", !canUseSubmissionDates);
  $("followUpDateField").classList.toggle("hidden", !canUseFollowUp);
  $("submittedDate").disabled = !canUseSubmissionDates;
  $("followUpDate").disabled = !canUseFollowUp;
  $("followUpReminder").disabled = !canUseFollowUp;
  if (!canUseSubmissionDates) {
    $("submittedDate").value = "";
    $("followUpDate").value = "";
    $("followUpReminder").checked = false;
    $("statusDateHelp").textContent = "Submission and follow-up dates become available after the application is submitted.";
  } else if (!canUseFollowUp) {
    $("followUpDate").value = "";
    $("followUpReminder").checked = false;
    $("statusDateHelp").textContent = "Follow-up date is used for Submitted or Waiting applications.";
  } else {
    $("statusDateHelp").textContent = "Use these dates to track submission and response follow-up.";
  }
}

function saveEntry() {
  pendingDeleteId = null;
  const entry = readForm();
  const existingIndex = entries.findIndex((item) => item.id === entry.id);
  const previous = existingIndex >= 0 ? entries[existingIndex] : null;
  refreshReminderDismissals(previous, entry);
  if (existingIndex >= 0) entries[existingIndex] = entry;
  else entries.unshift(entry);
  selectedId = entry.id;
  persist();
  setMode("dashboard");
  renderAll();
}

function refreshReminderDismissals(previous, entry) {
  let changed = false;
  if (entry.deadlineReminder && (!previous?.deadlineReminder || previous.deadline !== entry.deadline || previous.status !== entry.status)) {
    dismissedReminderIds.delete(reminderId(entry, "deadline"));
    changed = true;
  }
  if (entry.followUpReminder && (!previous?.followUpReminder || previous.followUpDate !== entry.followUpDate || previous.status !== entry.status)) {
    dismissedReminderIds.delete(reminderId(entry, "followup"));
    changed = true;
  }
  if (changed) saveDismissedReminderIds();
}

function cancelEdit() {
  pendingDeleteId = null;
  if (mode === "new") selectedId = null;
  setMode("dashboard");
  renderAll();
}

function deleteEntry() {
  const entry = selectedEntry();
  if (!entry) return;
  if (pendingDeleteId !== entry.id) {
    pendingDeleteId = entry.id;
    $("deleteEntry").textContent = "Confirm Delete";
    $("deleteEntryBottom").textContent = "Confirm Delete";
    $("savedState").textContent = `Click Confirm Delete to remove ${entry.key || entry.jobName || "this entry"}.`;
    return;
  }
  entries = entries.filter((item) => item.id !== entry.id);
  pendingDeleteId = null;
  selectedId = null;
  persist();
  setMode("dashboard");
  renderAll();
}

function deleteFromSummary(id, button) {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;
  if (pendingDeleteId !== id) {
    pendingDeleteId = id;
    button.textContent = "Confirm Delete";
    $("dashboardHint").textContent = `Click Confirm Delete to remove ${entry.key || entry.jobName || "this entry"}.`;
    return;
  }
  entries = entries.filter((item) => item.id !== id);
  pendingDeleteId = null;
  selectedId = null;
  persist();
  renderAll();
}

// Document management for per-application files and reusable defaults.
function renderDocumentRows(documents, editable) {
  if (!documents.length) return `<div class="empty">No documents attached.</div>`;
  return documents
    .map(
      (doc) => `
        <div class="doc-row">
          <div class="doc-name">
            <strong>${escapeHtml(doc.type || "Document")}</strong>
            <div>${escapeHtml(doc.name || "Unnamed file")}</div>
            <div class="muted">${formatBytes(doc.size || 0)} | ${escapeHtml(formatDateTime(doc.addedAt))}${doc.textPreview ? " | text readable" : ""}</div>
          </div>
          <div class="panel-actions">
            <button class="btn" type="button" data-doc-download="${doc.id}">Download</button>
            ${
              editable
                ? `<button class="btn danger" type="button" data-doc-remove="${doc.id}">Remove</button>`
                : ""
            }
          </div>
        </div>
      `,
    )
    .join("");
}

function renderFormDocs() {
  $("formDocs").innerHTML = renderDocumentRows(draftDocuments, true);
  document.querySelectorAll("#formDocs [data-doc-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      draftDocuments = draftDocuments.filter((doc) => doc.id !== button.dataset.docRemove);
      renderFormDocs();
      $("savedState").textContent = "Unsaved document change.";
    });
  });
  document.querySelectorAll("#formDocs [data-doc-download]").forEach((button) => {
    button.addEventListener("click", () => downloadDraftDocument(button.dataset.docDownload));
  });
}

function upsertDraftDocument(doc) {
  if (doc.type === "Other") {
    draftDocuments.push(doc);
    return;
  }
  const existingIndex = draftDocuments.findIndex((item) => item.type === doc.type);
  if (existingIndex >= 0) draftDocuments[existingIndex] = doc;
  else draftDocuments.push(doc);
}

function saveDefaultDocument(doc) {
  if (doc.type === "Other") return;
  const defaultDoc = {
    ...structuredClone(doc),
    id: crypto.randomUUID(),
    isDefault: true,
    addedAt: new Date().toISOString(),
  };
  const existingIndex = masterDocuments.findIndex((item) => item.type === doc.type);
  if (existingIndex >= 0) masterDocuments[existingIndex] = defaultDoc;
  else masterDocuments.unshift(defaultDoc);
  persistMasterDocuments();
  renderDefaultFilesHint();
}

function defaultDocumentCopies() {
  const uniqueDefaults = [];
  const seen = new Set();
  for (const doc of masterDocuments) {
    if (doc.type !== "Other" && seen.has(doc.type)) continue;
    if (doc.type !== "Other") seen.add(doc.type);
    uniqueDefaults.push(doc);
  }
  return uniqueDefaults.map((doc) => ({
    ...structuredClone(doc),
    id: crypto.randomUUID(),
    sourceDefaultId: doc.id,
    addedAt: new Date().toISOString(),
  }));
}

function renderDefaultFilesHint() {
  const defaults = masterDocuments.filter((doc) => doc.type !== "Other");
  $("defaultFilesHint").textContent = defaults.length
    ? `Defaults for new entries: ${defaults.map((doc) => `${doc.type}: ${doc.name}`).join("; ")}`
    : "No default files saved yet. Tick the box when uploading a CV or other core file to reuse it in future entries.";
}

function attachDocument() {
  const file = $("documentFile").files?.[0];
  if (!file) {
    alert("Choose a document first.");
    return;
  }
  if (file.size > maxFileBytes) {
    alert(`This file is too large for this local app. Keep each attached file under ${formatBytes(maxFileBytes)}.`);
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const dataUrl = reader.result;
      let doc = {
        id: crypto.randomUUID(),
        type: $("documentType").value,
        name: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
        dataUrl,
        textPreview: await extractTextPreview(file),
        addedAt: new Date().toISOString(),
      };
      if (serverStorage.ready) {
        doc = await uploadDocumentRecord(doc, {
          entry: { id: selectedId, key: $("key").value.trim() },
        });
      }
      upsertDraftDocument(doc);
      if ($("saveAsMaster").checked) {
        let defaultDoc = {
          ...doc,
          id: crypto.randomUUID(),
          dataUrl,
          isDefault: true,
        };
        if (serverStorage.ready) {
          defaultDoc = await uploadDocumentRecord(defaultDoc, { isDefault: true });
        }
        saveDefaultDocument(defaultDoc);
        $("saveAsMaster").checked = false;
      }
      $("documentFile").value = "";
      renderFormDocs();
      $("savedState").textContent = "Document attached. Save entry to keep it.";
    } catch (error) {
      console.warn("Document attach failed", error);
      alert("Could not attach that document. Please try a smaller file or restart the local tracker server.");
    }
  };
  reader.readAsDataURL(file);
}

async function uploadDocumentRecord(doc, options = {}) {
  if (!serverStorage.ready || !doc.dataUrl) return doc;
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: doc.id,
      type: doc.type,
      name: doc.name,
      size: doc.size,
      mime: doc.mime,
      dataUrl: doc.dataUrl,
      textPreview: doc.textPreview || "",
      addedAt: doc.addedAt,
      sourceDefaultId: doc.sourceDefaultId || "",
      isDefault: Boolean(options.isDefault),
      entryId: options.entry?.id || selectedId || "",
      entryKey: options.entry?.key || "",
    }),
  });
  if (!response.ok) throw new Error("Could not save uploaded file");
  return normalizeDocument(await response.json());
}

async function extractTextPreview(file) {
  const lowerName = file.name.toLowerCase();
  if (file.type === "text/plain" || lowerName.endsWith(".txt")) {
    return (await file.text()).slice(0, 30000);
  }
  if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
    try {
      const pdfjsLib = await loadPdfLib();
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const pageCount = Math.min(pdf.numPages, 20);
      const chunks = [];
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        chunks.push(content.items.map((item) => item.str).join(" "));
      }
      return chunks.join("\n\n").slice(0, 30000);
    } catch (error) {
      console.warn("PDF text extraction failed", error);
      return "";
    }
  }
  return "";
}

async function loadPdfLib() {
  if (!pdfLibPromise) {
    pdfLibPromise = import("./vendor/pdf.min.mjs").then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";
      return pdfjsLib;
    });
  }
  return pdfLibPromise;
}

function downloadDocument(entry, id) {
  const doc = (entry.documents || []).find((item) => item.id === id);
  if (doc) downloadStoredDocument(doc);
}

function downloadDraftDocument(id) {
  const doc = draftDocuments.find((item) => item.id === id);
  if (doc) downloadStoredDocument(doc);
}

function copyEntryDetails(id) {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;
  navigator.clipboard.writeText(entryText(entry)).then(() => {
    $("dashboardHint").textContent = "Entry details copied.";
  });
}

function entryText(entry) {
  return [
    `Short key: ${entry.key}`,
    `Application type: ${applicationTypeLabel(entry.applicationType)}`,
    `Opportunity name: ${entry.jobName}`,
    `Country / city: ${entry.country}`,
    `Deadline: ${entry.deadline}`,
    `Status: ${entry.status}`,
    `PI / contact: ${entry.piName}`,
    `Institution / group: ${entry.institution}`,
    `Job link: ${entry.jobUrl}`,
    `Group information: ${entry.groupInfo}`,
    `Job information: ${entry.jobBrief}`,
    `Key points: ${entry.keyPoints}`,
    `CV / resume changes: ${entry.cvChanges}`,
    `Reference letters: ${entry.referenceLetters}`,
    `Papers to read: ${entry.papersToRead}`,
    `Other preparation: ${entry.otherPreparation}`,
    `Type-specific details: ${typeDetailsSummary(entry)}`,
    `Status notes: ${entry.statusNotes}`,
    `Documents: ${(entry.documents || []).map((doc) => `${doc.type}: ${doc.name}`).join("; ")}`,
  ].join("\n");
}

// Import/export. CSV is the human-readable interchange format; JSON remains supported for backups.
function exportJson() {
  const blob = new Blob([JSON.stringify({ entries, masterDocuments, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
  downloadBlob(blob, "application-tracker.json");
}

const csvHeaders = [
  "applicationType",
  "key",
  "jobName",
  "country",
  "deadline",
  "deadlineReminder",
  "status",
  "institution",
  "piName",
  "jobUrl",
  "groupInfo",
  "jobBrief",
  "keyPoints",
  "cvChanges",
  "referenceLetters",
  "papersToRead",
  "otherPreparation",
  "submittedDate",
  "followUpDate",
  "followUpReminder",
  "statusNotes",
  "typeDetails",
  "documentsList",
  "createdAt",
  "updatedAt",
];

function exportCsv() {
  const rows = entries.map((entry) =>
    csvHeaders.map((field) => {
      if (field === "documentsList") return csvCell(documentSummary(entry.documents || []));
      if (field === "typeDetails") return csvCell(typeDetailsSummary(entry));
      return csvCell(entry[field] || "");
    }),
  );
  const csv = [csvHeaders.join(","), ...rows.map((row) => row.join(","))].join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv" }), "application-tracker.csv");
  $("moreMenu").classList.add("hidden");
}

function importFiles(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const text = reader.result;
      let importedEntries = [];
      if (file.name.toLowerCase().endsWith(".json")) {
        const imported = JSON.parse(text);
        const jsonEntries = Array.isArray(imported) ? imported : imported.entries;
        if (!Array.isArray(jsonEntries)) throw new Error("Expected entries");
        importedEntries = await prepareImportedEntries(jsonEntries);
        masterDocuments = Array.isArray(imported.masterDocuments) ? await prepareImportedDocuments(imported.masterDocuments, true) : masterDocuments;
      } else {
        importedEntries = parseApplicationsCsv(text).map(normalizeEntry);
      }
      entries = mergeImportedEntries(entries, importedEntries);
      selectedId = null;
      persist();
      persistMasterDocuments();
      setMode("dashboard");
      renderAll();
      $("dashboardHint").textContent = `Added ${importedEntries.length} imported applications. Tracker now has ${entries.length}.`;
    } catch {
      alert("Could not import that file. Use the CSV from Export Files or a JSON backup.");
    }
  };
  reader.readAsText(file);
}

function mergeImportedEntries(existingEntries, importedEntries) {
  const existingIds = new Set(existingEntries.map((entry) => entry.id));
  const existingKeys = new Set(existingEntries.map((entry) => (entry.key || "").trim()).filter(Boolean));
  const now = new Date().toISOString();
  const additions = importedEntries.map((entry) => {
    const imported = normalizeEntry(entry);
    imported.id = existingIds.has(imported.id) ? crypto.randomUUID() : imported.id;
    existingIds.add(imported.id);
    if (imported.key && existingKeys.has(imported.key)) {
      imported.key = nextImportedKey(imported.key, existingKeys);
    }
    if (imported.key) existingKeys.add(imported.key);
    imported.createdAt = imported.createdAt || now;
    imported.updatedAt = now;
    return imported;
  });
  return [...additions, ...existingEntries];
}

function nextImportedKey(baseKey, existingKeys) {
  const cleanBase = String(baseKey || "IMPORTED").trim() || "IMPORTED";
  let counter = 2;
  let candidate = `${cleanBase}-${counter}`;
  while (existingKeys.has(candidate)) {
    counter += 1;
    candidate = `${cleanBase}-${counter}`;
  }
  return candidate;
}

async function prepareImportedEntries(importedEntries) {
  const prepared = [];
  for (const entry of importedEntries) {
    const normalized = normalizeEntry(entry);
    normalized.documents = await prepareImportedDocuments(normalized.documents || [], false, normalized);
    prepared.push(normalized);
  }
  return prepared;
}

async function prepareImportedDocuments(documents, isDefault, entry = null) {
  const prepared = [];
  for (const doc of documents || []) {
    const normalized = normalizeDocument(doc);
    prepared.push(await uploadDocumentRecord(normalized, { isDefault, entry }));
  }
  return prepared;
}

function parseApplicationsCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => {
    const entry = createBlankEntry();
    headers.forEach((header, index) => {
      if (header === "documentsList") return;
      if (header === "typeDetails") {
        entry.typeDetails = parseTypeDetails(row[index] || "");
        return;
      }
      if (fields.includes(header) || ["status", "createdAt", "updatedAt"].includes(header)) {
        entry[header] = row[index] || "";
      }
    });
    entry.id = crypto.randomUUID();
    entry.applicationType = applicationTypes[entry.applicationType] ? entry.applicationType : "postdoc";
    entry.status = statuses.includes(entry.status) ? entry.status : "Not Submitted";
    entry.documents = [];
    entry.createdAt = entry.createdAt || new Date().toISOString();
    entry.updatedAt = entry.updatedAt || entry.createdAt;
    return entry;
  });
}

function parseTypeDetails(value) {
  const text = String(value || "").trim();
  return text ? { importedNotes: text } : {};
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function clearFilters() {
  $("search").value = "";
  $("statusFilter").value = "all";
  $("deadlineFilter").value = "all";
  $("sortBy").value = "updated";
  entriesPage = 1;
  renderEntries();
}

function renderEntriesFromFirstPage() {
  entriesPage = 1;
  selectedId = null;
  pendingBulkDelete = false;
  selectedEntryIds = new Set();
  renderEntries();
}

function addDemoEntries() {
  const demoEntries = createDemoEntries();
  const existingDemoKeys = new Set(entries.map((entry) => demoBaseKey(entry.key)));
  const missingDemos = demoEntries.filter((entry) => !existingDemoKeys.has(demoBaseKey(entry.key)));
  if (!missingDemos.length) {
    $("dashboardHint").textContent = "Demo entries are already in this tracker.";
    $("moreMenu").classList.add("hidden");
    return;
  }
  entries = mergeImportedEntries(entries, missingDemos);
  selectedId = null;
  persist();
  setMode("dashboard");
  renderAll();
  $("dashboardHint").textContent = `Added ${missingDemos.length} demo academic application${missingDemos.length === 1 ? "" : "s"}.`;
  $("moreMenu").classList.add("hidden");
}

function demoBaseKey(key) {
  return String(key || "").toUpperCase().replace(/-\d+$/, "");
}

function createDemoEntries() {
  const now = new Date().toISOString();
  return [
    {
      ...createBlankEntry(),
      id: crypto.randomUUID(),
      applicationType: "postdoc",
      key: "DEMO-POSTDOC",
      jobName: "Quantum materials postdoctoral researcher",
      country: "Germany / Munich",
      deadline: "2026-09-15",
      piName: "Prof. Elena Fischer",
      institution: "Max Planck Institute demo group",
      groupInfo: "Condensed matter theory group working on quantum transport, topology, and collaboration with experimental labs.",
      jobBrief: "Two-year postdoc on quantum materials modeling, numerical simulations, and manuscript preparation.",
      keyPoints: "Emphasize publications, numerical methods, collaboration, and independence.",
      cvChanges: "Move quantum transport projects and selected publications to the top.",
      referenceLetters: "Ask PhD advisor and recent collaborator by August 20.",
      papersToRead: "Recent group papers on topological transport and correlated materials.",
      otherPreparation: "Draft inquiry email and research fit paragraph.",
      typeDetails: {
        contractLength: "Two years, possible one-year extension.",
        researchFit: "Strong fit through prior transport simulations and quantum theory background.",
        methodsToHighlight: "Python, Julia, tight-binding models, numerical diagonalization, manuscript writing.",
        mobilityVisaNotes: "Check German researcher visa timeline.",
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      ...createBlankEntry(),
      id: crypto.randomUUID(),
      applicationType: "phd",
      key: "DEMO-PHD",
      jobName: "PhD in photonic quantum computing",
      country: "Netherlands / Delft",
      deadline: "2026-10-01",
      piName: "Dr. Sofia van Dijk",
      institution: "Demo University Quantum Photonics Lab",
      groupInfo: "Lab develops integrated photonic circuits for quantum information processing.",
      jobBrief: "Four-year PhD project combining device design, experiments, and quantum optics theory.",
      keyPoints: "Highlight thesis project, coursework, research motivation, and supervisor fit.",
      cvChanges: "Add coursework and project bullets relevant to optics and quantum information.",
      referenceLetters: "Two academic recommendations required through application portal.",
      papersToRead: "Supervisor papers on integrated photonics and entangled photon sources.",
      otherPreparation: "Statement of purpose draft and transcript upload.",
      typeDetails: {
        programRequirements: "CV, statement of purpose, transcripts, two recommendation letters.",
        fundingNotes: "Fully funded four-year contract with salary scale listed in call.",
        sopFocus: "Connect previous quantum optics project to integrated photonics motivation.",
        recommendationPlan: "Ask master thesis supervisor and quantum course instructor.",
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      ...createBlankEntry(),
      id: crypto.randomUUID(),
      applicationType: "fellowship",
      key: "DEMO-FELLOWSHIP",
      jobName: "International postdoctoral fellowship",
      country: "France / Paris",
      deadline: "2026-11-20",
      piName: "Host mentor: Prof. Camille Moreau",
      institution: "Demo Institute for Theoretical Physics",
      groupInfo: "Host group works on open quantum systems, thermodynamics, and nonequilibrium methods.",
      jobBrief: "Fellowship requires research proposal, host commitment letter, CV, and impact statement.",
      keyPoints: "Emphasize novelty, host fit, training plan, and international mobility.",
      cvChanges: "Highlight independent projects, invited talks, and publication trajectory.",
      referenceLetters: "Host letter plus two referees.",
      papersToRead: "Host papers on thermodynamic uncertainty relations.",
      otherPreparation: "Draft proposal aims and impact section.",
      typeDetails: {
        eligibility: "Check mobility rule and years since PhD.",
        proposalIdea: "Nonequilibrium thermodynamics for mesoscopic quantum devices.",
        hostCommitments: "Need host supervision plan and institutional support letter.",
        reviewCriteria: "Excellence, impact, implementation, training environment.",
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      ...createBlankEntry(),
      id: crypto.randomUUID(),
      applicationType: "grant",
      key: "DEMO-GRANT",
      jobName: "Early career quantum science grant",
      country: "United Kingdom / Remote host",
      deadline: "2026-12-05",
      piName: "Program officer: demo contact",
      institution: "Demo Research Council",
      groupInfo: "Funding call supports early-career independent research in quantum technologies.",
      jobBrief: "Proposal requires project summary, budget, host letter, CV, and data management plan.",
      keyPoints: "Clarify aims, feasibility, budget justification, and expected outputs.",
      cvChanges: "Add grant-relevant leadership, collaborations, and project management evidence.",
      referenceLetters: "Host institution endorsement required before submission.",
      papersToRead: "Call guidance, evaluation rubric, and funded project examples.",
      otherPreparation: "Create budget table and timeline.",
      typeDetails: {
        budgetNotes: "Salary support, travel, compute, publication costs; check overhead limits.",
        proposalSections: "Aims, methods, work packages, risk plan, impact, data plan.",
        eligibility: "Early-career applicant with host institution approval.",
        internalDeadline: "Submit to grants office two weeks before funder deadline.",
      },
      createdAt: now,
      updatedAt: now,
    },
  ].map(normalizeEntry);
}

// Main render coordinator.
function renderAll() {
  renderApplicationTypeOptions();
  renderFilters();
  renderStats();
  renderNotifications();
  renderEntries();
  setMode(mode);
}

function toggleAiPanel() {
  const next = $("aiPanel").dataset.open !== "true";
  $("aiPanel").dataset.open = String(next);
  if (next) $("notificationPanel").dataset.open = "false";
  if (next) {
    $("aiQuestion").value = "";
    if (!aiChatHistory.length) renderAiThread([]);
  }
  setMode("dashboard");
  $("moreMenu").classList.add("hidden");
}

function closeAiPanel() {
  $("aiPanel").dataset.open = "false";
  setMode("dashboard");
}

// Navigation helpers.
function goHome() {
  pendingDeleteId = null;
  selectedId = null;
  $("aiPanel").dataset.open = "false";
  $("notificationPanel").dataset.open = "false";
  setMode("dashboard");
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// AI assistant: provider-backed when configured, with a local fallback for simple tracker questions.
async function askAiFromTracker() {
  const question = $("aiQuestion").value.trim();
  if (!question) {
    $("aiSettingsStatus").textContent = "Ask a question first. For example: which applications are waiting, which are urgent, or draft an inquiry email for OX-IMMUNO.";
    $("aiQuestion").focus();
    return;
  }
  if (aiRequestInFlight) {
    $("aiSettingsStatus").textContent = "AI is already working on the previous question.";
    return;
  }

  aiRequestInFlight = true;
  updateAiButtonStates();
  try {
    $("aiQuestion").value = "";
    addAiMessage("user", question);
    let connectionError = "";
    if (canAnswerLocally(question)) {
      setAiAnswer(await localAssistantAnswer(question));
      return;
    }
    if (aiSettings.configured) {
      if (Date.now() < aiCooldownUntil) {
        const seconds = Math.ceil((aiCooldownUntil - Date.now()) / 1000);
        const provider = aiProviderLabel(aiSettings.provider);
        setAiAnswer(await localAssistantAnswer(question, `${provider} asked us to wait about ${seconds} more second${seconds === 1 ? "" : "s"} before trying again.`));
        return;
      }
      setAiAnswer("Asking connected AI provider...", { temporary: true });
      const connected = await askConnectedAi(question);
      if (connected.answer) {
        setAiAnswer(connected.answer);
        return;
      }
      connectionError = connected.error || "The connected AI did not return an answer.";
    }

    setAiAnswer(await localAssistantAnswer(question, connectionError));
  } finally {
    aiRequestInFlight = false;
    updateAiButtonStates();
  }
}

function canAnswerLocally(question) {
  const lower = String(question || "").toLowerCase();
  return [
    "how many",
    "summary",
    "summarise",
    "summarize",
    "overview",
    "not submitted",
    "pending",
    "waiting",
    "response",
    "deadline",
    "urgent",
    "important",
  ].some((phrase) => lower.includes(phrase));
}

async function localAssistantAnswer(question, connectionError = "") {
  const lower = question.toLowerCase();
  const previousAssistant = [...aiChatHistory].reverse().find((message) => message.role === "assistant");
  if (previousAssistant && /\b(shorter|summari[sz]e|rewrite|revise|make it|make this|that|it)\b/i.test(question)) {
    return localFollowUpAnswer(question, previousAssistant.content, connectionError);
  }
  const referenced = findReferencedEntry(question) || lastReferencedEntryFromChat() || selectedEntry();
  if (lower.includes("not submitted")) {
    const notSubmitted = entries.filter((entry) => entry.status === "Not Submitted");
    return notSubmitted.length
      ? withConnectionNote(`Not submitted applications:\n\n${notSubmitted.map((entry) => `- ${entry.key || "NO-KEY"}: ${entry.jobName || "Untitled"}${entry.deadline ? `, deadline ${formatDate(entry.deadline)}` : ""}`).join("\n")}`, connectionError)
      : withConnectionNote("No applications are marked Not Submitted right now.", connectionError);
  }
  if (lower.includes("pending") || lower.includes("waiting") || lower.includes("response")) {
    const pending = entries.filter((entry) => ["Submitted", "Waiting", "Interview"].includes(entry.status));
    return withConnectionNote(pending.length
      ? `Pending applications:\n\n${pending.map((entry) => `- ${entry.key || "NO-KEY"}: ${entry.jobName || "Untitled"} (${entry.status})${entry.deadline ? `, deadline ${formatDate(entry.deadline)}` : ""}${entry.followUpDate ? `, follow up ${formatDate(entry.followUpDate)}` : ""}`).join("\n")}`
      : "No pending Submitted, Waiting, or Interview applications right now.", connectionError);
  }
  if (lower.includes("important") || lower.includes("urgent") || lower.includes("deadline")) {
    const urgent = [...entries]
      .filter((entry) => entry.deadline && !["Accepted", "Rejected"].includes(entry.status))
      .sort((a, b) => dateRank(a.deadline) - dateRank(b.deadline))
      .slice(0, 5);
    return withConnectionNote(urgent.length
      ? `Most urgent applications by deadline:\n\n${urgent.map((entry) => `- ${entry.key || "NO-KEY"}: ${entry.jobName || "Untitled"} - ${formatDate(entry.deadline)} (${entry.status})`).join("\n")}`
      : "No active applications with deadlines are saved yet.", connectionError);
  }
  if (lower.includes("email") || lower.includes("inquiry") || lower.includes("write")) {
    const entry = referenced || entries[0];
    return withConnectionNote(draftInquiryText(entry, question), connectionError);
  }
  if (lower.includes("cv") || lower.includes("document") || lower.includes("file") || lower.includes("grammar") || lower.includes("fit") || lower.includes("match") || lower.includes("improve")) {
    const entry = referenced || entries[0];
    const docs = [...(entry?.documents || []), ...masterDocuments];
    setAiAnswer("Reading saved files...", { temporary: true });
    await ensureDocumentTextPreviews(docs);
    const textDocs = docs.filter((doc) => doc.textPreview);
    const cvDoc = textDocs.find((doc) => doc.type === "CV") || textDocs[0];
    const jobText = [entry?.jobName, entry?.jobBrief, entry?.groupInfo, entry?.keyPoints, entry?.papersToRead].join(" ");
    return withConnectionNote(cvDoc
      ? buildCvFitAnswer(entry, cvDoc, jobText)
      : [
          `Files I can see locally for ${entry?.key || "this tracker"}:`,
          docs.length ? docs.map((doc) => `- ${doc.type || "Document"}: ${doc.name || "Unnamed file"}`).join("\n") : "- No files attached yet.",
          "",
          "I can read selectable-text PDFs and .txt files. If a PDF is scanned/image-only, it will need OCR later. Direct DOCX/PDF rewriting is not built in yet.",
        ].join("\n"), connectionError);
  }

  if (lower.includes("summary") || lower.includes("summarise") || lower.includes("summarize") || lower.includes("overview") || lower.includes("how many")) {
    return withConnectionNote([
      "Tracker summary:",
      `Total applications: ${entries.length}`,
      `Not submitted: ${entries.filter((entry) => entry.status === "Not Submitted").length}`,
      `Submitted: ${entries.filter((entry) => entry.status === "Submitted").length}`,
      `Waiting: ${entries.filter((entry) => entry.status === "Waiting").length}`,
      `Interview: ${entries.filter((entry) => entry.status === "Interview").length}`,
      `Accepted: ${entries.filter((entry) => entry.status === "Accepted").length}`,
      `Rejected: ${entries.filter((entry) => entry.status === "Rejected").length}`,
    ].join("\n"), connectionError);
  }

  return withConnectionNote([
    "I could not follow that instruction reliably in the built-in local assistant.",
    "",
    "What I can do locally right now:",
    "- list not submitted, pending, waiting, or urgent applications",
    "- draft an inquiry email for a short key or selected entry",
    "- compare readable PDF/TXT CV text with an application",
    "- shorten or lightly revise the previous answer",
    "",
    "For open-ended follow-up editing, connect Ollama or another AI provider in AI connection.",
    "Tracker summary:",
    `Total applications: ${entries.length}`,
  ].join("\n"), connectionError);
}

async function askConnectedAi(question) {
  try {
    const allDocs = [...entries.flatMap((entry) => entry.documents || []), ...masterDocuments];
    await ensureDocumentTextPreviews(allDocs);
    const response = await fetch("/api/ai/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        context: buildAiContext(question),
        history: compactAiHistory(question),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (result.retryAfterSeconds) aiCooldownUntil = Date.now() + result.retryAfterSeconds * 1000;
    if (!response.ok) throw new Error(formatAiError(result));
    if (result.model) $("aiSettingsStatus").textContent = `Answered with ${result.model}.`;
    return { answer: result.answer || "", error: result.answer ? "" : "The AI provider returned an empty answer." };
  } catch (error) {
    console.warn("Connected AI failed; falling back to local assistant", error);
    $("aiSettingsStatus").textContent = `Connected AI failed, using local assistant. ${error.message || ""}`.trim();
    return { answer: "", error: error.message || "Connected AI failed." };
  }
}

function formatAiError(result) {
  const parts = [result.error || "AI request failed"];
  if (result.retryAfterSeconds) {
    parts.push(`Retry after about ${result.retryAfterSeconds} second${result.retryAfterSeconds === 1 ? "" : "s"}.`);
  }
  if (result.quota?.id || result.quota?.limit) {
    parts.push(`Quota: ${[result.quota.id, result.quota.limit ? `limit ${result.quota.limit}` : ""].filter(Boolean).join(", ")}.`);
  }
  return parts.join(" ");
}

function buildAiContext(question = "") {
  const lower = String(question || "").toLowerCase();
  const wantsDocuments = /\b(cv|document|file|pdf|grammar|fit|match|improve|revise|edit)\b/i.test(question);
  const referenced = findReferencedEntry(question) || lastReferencedEntryFromChat() || selectedEntry();
  const activeEntries = referenced ? [referenced] : entries.slice(0, 25);
  const entrySummary = entries
    .map((entry) => `${entry.key || "NO-KEY"} | ${applicationTypeLabel(entry.applicationType)} | ${entry.jobName || "Untitled"} | ${entry.status} | deadline ${entry.deadline || "none"} | ${entry.institution || "no institution"}`)
    .join("\n");
  const detailedBlocks = activeEntries.map((entry) => {
    const docs = (entry.documents || [])
      .filter((doc) => wantsDocuments || referenced)
      .map((doc) => [
        `Document: ${doc.type || "Document"} - ${doc.name || "Unnamed"}`,
        doc.textPreview ? `Readable text excerpt:\n${doc.textPreview.slice(0, 1800)}` : "Readable text excerpt: not available",
      ].join("\n"))
      .join("\n\n");
    return [entryText(entry), docs].filter(Boolean).join("\n\n");
  });
  const defaultDocs = masterDocuments
    .filter(() => wantsDocuments)
    .map((doc) => [
      `Default document: ${doc.type || "Document"} - ${doc.name || "Unnamed"}`,
      doc.textPreview ? `Readable text excerpt:\n${doc.textPreview.slice(0, 1800)}` : "Readable text excerpt: not available",
    ].join("\n"))
    .join("\n\n");
  return [
    "Application index:",
    entrySummary || "No applications saved.",
    "",
    referenced ? "Focused application details:" : lower.includes("all") || lower.includes("summary") ? "Application details:" : "Relevant application details:",
    detailedBlocks.join("\n\n---\n\n") || "No detailed application selected.",
    defaultDocs ? `\n\nReusable/default documents:\n${defaultDocs}` : "",
  ].join("\n");
}

function compactAiHistory(question) {
  const currentQuestion = String(question || "").trim();
  return aiChatHistory
    .filter((message) => message.content !== "Asking connected AI provider..." && message.content !== "Reading saved files...")
    .slice(-6)
    .filter((message, index, list) => index !== list.length - 1 || message.role !== "user" || message.content === currentQuestion)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 2500),
    }));
}

function findReferencedEntry(text) {
  const lower = String(text || "").toLowerCase();
  return entries.find((entry) => {
    const key = (entry.key || "").toLowerCase();
    const name = (entry.jobName || "").toLowerCase();
    return (key && lower.includes(key)) || (name && lower.includes(name));
  }) || null;
}

function lastReferencedEntryFromChat() {
  for (const message of [...aiChatHistory].reverse()) {
    const entry = findReferencedEntry(message.content);
    if (entry) return entry;
  }
  return null;
}

function withConnectionNote(answer, connectionError) {
  if (!connectionError) return answer;
  return [
    `Connection note: ${connectionError}`,
    "I used the built-in local assistant for this answer.",
    "",
    answer,
  ].join("\n");
}

function localFollowUpAnswer(question, previousAnswer, connectionError = "") {
  const wantsShorter = /\b(shorter|summari[sz]e|brief|concise)\b/i.test(question);
  if (wantsShorter) {
    const lines = previousAnswer
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith("[AI provider:"))
      .slice(0, 6);
    return withConnectionNote([
      "Here is a shorter version of the previous answer:",
      "",
      ...lines.map((line) => `- ${line.replace(/^[-*\d.]+\s*/, "")}`),
      "",
      "For richer follow-up rewriting, connect Ollama or another AI provider in AI connection.",
    ].join("\n"), connectionError);
  }
  return withConnectionNote([
    "I can see your previous answer in this chat now.",
    "",
    "For true rewrite-style follow-ups, connect Ollama or another AI provider in AI connection. The built-in local assistant can summarize tracker data, but it cannot deeply rewrite earlier text.",
    "",
    "Previous answer:",
    previousAnswer,
  ].join("\n"), connectionError);
}

function setAiAnswer(text, options = {}) {
  const answer = String(text || "");
  addAiMessage("assistant", answer, options);
}

function addAiMessage(role, text, options = {}) {
  const message = { role, content: String(text || ""), createdAt: new Date().toISOString() };
  if (options.replaceHistory) aiChatHistory = [];
  if (options.temporary) {
    renderAiThread([...aiChatHistory, message]);
    return;
  }
  aiChatHistory.push(message);
  if (aiChatHistory.length > 12) aiChatHistory = aiChatHistory.slice(-12);
  renderAiThread(aiChatHistory);
  if (role === "assistant") lastAiAnswerText = message.content;
}

function clearAiChat() {
  aiChatHistory = [];
  lastAiAnswerText = "";
  renderAiThread([]);
}

function renderAiThread(messages) {
  $("aiThread").innerHTML = messages
    .map((message) => {
      const roleLabel = message.role === "user" ? "You" : "Assistant";
      const body = message.role === "assistant"
        ? `<div class="ai-output">${renderMarkdown(message.content)}</div>`
        : `<div class="ai-bubble">${escapeHtml(message.content)}</div>`;
      return `<div class="ai-message ${message.role}"><div class="ai-role">${roleLabel}</div>${body}</div>`;
    })
    .join("");
  if (messages.length) $("aiThread").scrollTop = $("aiThread").scrollHeight;
}

function renderMarkdown(markdown) {
  const text = String(markdown || "");
  const blocks = [];
  const codeBlocks = [];
  const withoutCode = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    const token = `@@CODE_BLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(code.replace(/^\n|\n$/g, ""));
    return token;
  });
  const lines = withoutCode.split(/\r?\n/);
  let listType = "";
  let listItems = [];
  const flushList = () => {
    if (!listType) return;
    blocks.push(`<${listType}>${listItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join("")}</${listType}>`);
    listType = "";
    listItems = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    if (trimmed.startsWith("@@CODE_BLOCK_")) {
      flushList();
      const index = Number(trimmed.match(/\d+/)?.[0] || 0);
      blocks.push(`<pre><code>${escapeHtml(codeBlocks[index] || "")}</code></pre>`);
      continue;
    }
    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = Math.min(4, Math.max(3, heading[1].length + 2));
      blocks.push(`<h${level}>${formatInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      const nextType = unordered ? "ul" : "ol";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((unordered || ordered)[1]);
      continue;
    }
    flushList();
    if (trimmed.startsWith("> ")) {
      blocks.push(`<blockquote>${formatInlineMarkdown(trimmed.slice(2))}</blockquote>`);
    } else {
      blocks.push(`<p>${formatInlineMarkdown(trimmed)}</p>`);
    }
  }
  flushList();
  return blocks.join("");
}

function formatInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function buildCvFitAnswer(entry, doc, jobText) {
  const cvText = doc.textPreview || "";
  const keywords = extractKeywords(jobText).slice(0, 14);
  const present = keywords.filter((word) => cvText.toLowerCase().includes(word.toLowerCase()));
  const missing = keywords.filter((word) => !cvText.toLowerCase().includes(word.toLowerCase()));
  return [
    `CV/application fit for ${entry?.key || "this entry"} using ${doc.name}:`,
    "",
    "Important job/group terms found in the entry:",
    keywords.length ? keywords.map((word) => `- ${word}`).join("\n") : "- Add more job/group/key point details to compare better.",
    "",
    "Terms already visible in the CV text:",
    present.length ? present.map((word) => `- ${word}`).join("\n") : "- I did not find obvious keyword matches yet.",
    "",
    "Possible gaps to address in the CV or cover letter:",
    missing.length ? missing.map((word) => `- Add or strengthen evidence for: ${word}`).join("\n") : "- The main entry keywords appear to be represented.",
    "",
    "Suggested CV changes:",
    `- Put the most relevant projects near the top for ${entry?.jobName || "this role"}.`,
    `- Add one or two bullets that explicitly connect your experience to ${entry?.groupInfo || entry?.jobBrief || "the group/job focus"}.`,
    "- Mirror important job wording where it is truthful and specific.",
    "- Add measurable outcomes for methods, papers, collaborations, or grants where possible.",
    "",
    "Readable CV excerpt:",
    cvText.slice(0, 1600) || "No text extracted.",
  ].join("\n");
}

function extractKeywords(text) {
  const stop = new Set(["the", "and", "for", "with", "from", "that", "this", "postdoc", "position", "application", "research", "group", "work", "role", "project", "your", "you", "are", "will", "can", "not", "yet", "about"]);
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !stop.has(word));
  const counts = new Map();
  words.forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([word]) => word);
}

async function ensureDocumentTextPreviews(documents) {
  let changed = false;
  for (const doc of documents) {
    const name = (doc.name || "").toLowerCase();
    const source = doc.dataUrl || doc.url;
    if (doc.textPreview || !source || (!name.endsWith(".pdf") && !name.endsWith(".txt"))) continue;
    try {
      const blob = await (await fetch(source)).blob();
      doc.textPreview = await extractTextPreview({
        name: doc.name || "document",
        type: doc.mime || blob.type,
        arrayBuffer: () => blob.arrayBuffer(),
        text: () => blob.text(),
      });
      changed = true;
    } catch (error) {
      console.warn("Stored document text extraction failed", error);
    }
  }
  if (changed) {
    persist();
    persistMasterDocuments();
  }
}

function draftInquiryText(entry, question) {
  if (!entry) return "No application entry is available yet.";
  return [
    `Subject: ${applicationTypeLabel(entry.applicationType)} opportunity: ${entry.jobName || "your group"}`,
    "",
    `Dear ${entry.piName || "Professor"},`,
    "",
    `I am writing to inquire about the ${entry.jobName || `${applicationTypeLabel(entry.applicationType)} opportunity`}${entry.institution ? ` at ${entry.institution}` : ""}. I am especially interested in ${entry.groupInfo || entry.keyPoints || "the research direction of your group or program"}.`,
    "",
    `My background is a fit because ${entry.cvChanges || entry.jobBrief || "my research experience and methods align with the position"}.`,
    entry.papersToRead ? `I am also reviewing the following work to understand the group better: ${entry.papersToRead}` : "",
    question ? `\nUser instruction: ${question}` : "",
    "",
    "Best regards,",
    "[Your name]",
  ].filter(Boolean).join("\n");
}

// Generic formatting and browser utility functions.
function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function dateRank(value) {
  return value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;
}

function formatDate(value) {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value) {
  if (!value) return "never";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadDataUrl(dataUrl, filename) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename || "document";
  anchor.click();
}

function downloadStoredDocument(doc) {
  if (!doc) return;
  const anchor = document.createElement("a");
  anchor.href = doc.url || doc.dataUrl;
  anchor.download = doc.name || "document";
  anchor.click();
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem(themeStorageKey, nextTheme);
  $("toggleTheme").textContent = nextTheme === "dark" ? "Light Theme" : "Dark Theme";
}

function initializeTheme() {
  applyTheme(localStorage.getItem(themeStorageKey) || "light");
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  $("moreMenu").classList.add("hidden");
}

// Event wiring and app bootstrap.
$("moreButton").addEventListener("click", () => $("moreMenu").classList.toggle("hidden"));
document.addEventListener("click", (event) => {
  if (!$("moreButton").contains(event.target) && !$("moreMenu").contains(event.target)) {
    $("moreMenu").classList.add("hidden");
  }
});
$("homeTitle").addEventListener("click", goHome);
$("notificationsButton").addEventListener("click", toggleNotifications);
$("newEntry").addEventListener("click", startNewEntry);
$("toggleAi").addEventListener("click", toggleAiPanel);
$("addDemoEntries").addEventListener("click", addDemoEntries);
$("toggleTheme").addEventListener("click", toggleTheme);
$("closeAi").addEventListener("click", closeAiPanel);
$("askAi").addEventListener("click", askAiFromTracker);
$("clearAiChat").addEventListener("click", clearAiChat);
$("aiQuestion").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    askAiFromTracker();
  }
});
$("aiProvider").addEventListener("change", updateAiProviderUi);
$("saveAiSettings").addEventListener("click", () => saveAiSettings());
$("clearAiKey").addEventListener("click", clearSavedAiKey);
$("copyAiAnswer").addEventListener("click", () => {
  navigator.clipboard.writeText(lastAiAnswerText).then(() => {
    $("copyAiAnswer").textContent = "Copied";
    window.setTimeout(() => {
      $("copyAiAnswer").textContent = "Copy Last Answer";
    }, 1200);
  });
});
$("saveEntry").addEventListener("click", saveEntry);
$("saveEntryBottom").addEventListener("click", saveEntry);
$("cancelEdit").addEventListener("click", cancelEdit);
$("cancelEditBottom").addEventListener("click", cancelEdit);
$("deleteEntry").addEventListener("click", deleteEntry);
$("deleteEntryBottom").addEventListener("click", deleteEntry);
$("uploadDocument").addEventListener("click", attachDocument);
$("exportCsv").addEventListener("click", exportCsv);
$("importFiles").addEventListener("click", () => $("importJson").click());
$("importJson").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) importFiles(file);
  event.target.value = "";
});
$("search").addEventListener("input", renderEntriesFromFirstPage);
$("statusFilter").addEventListener("change", renderEntriesFromFirstPage);
$("deadlineFilter").addEventListener("change", renderEntriesFromFirstPage);
$("sortBy").addEventListener("change", renderEntriesFromFirstPage);
$("clearFilters").addEventListener("click", clearFilters);
$("applicationType").addEventListener("change", () => {
  collectVisibleTypeDetails();
  updateApplicationTypeUi($("applicationType").value);
  $("savedState").textContent = "Unsaved application type change.";
});
fields.forEach((field) => {
  $(field).addEventListener("input", () => {
    $("savedState").textContent = "Unsaved changes.";
  });
});
["deadlineReminder", "followUpReminder"].forEach((field) => {
  $(field).addEventListener("change", () => {
    $("savedState").textContent = "Unsaved reminder change.";
  });
});

initializeTheme();
initializeApp();
