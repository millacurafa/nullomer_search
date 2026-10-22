"use strict";

const sampleGenomes = [
  {
    name: "E. coli K-12",
    files: ["data/NC_000913_K12.fasta"],
  },
  {
    name: "C. metallidurans CH34",
    files: [
      "data/NC_007973.1_CH34_1.fasta",
      "data/NC_007974.2_CH34_2.fasta",
      "data/NC_007971.2_30.fasta",
      "data/NC_007972.2_28.fasta",
      "data/NC_007680.1_P6.fasta",
    ],
  },
];
const absentPreviewLimit = 500;
const state = { genomes: [], nextId: 1, result: null, worker: null };

const genomeList = document.querySelector("#genome-list");
const genomeTemplate = document.querySelector("#genome-template");
const analyzeButton = document.querySelector("#analyze-button");
const exampleButton = document.querySelector("#example-button");
const addGenomeButton = document.querySelector("#add-genome");
const statusBox = document.querySelector("#status");
const resultsSection = document.querySelector("#results");

function showStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.hidden = !message;
  statusBox.classList.toggle("error", isError);
}

function markResultsOutdated() {
  state.result = null;
  resultsSection.hidden = true;
}

function newGenome(name = "", records = []) {
  markResultsOutdated();
  const genome = { id: state.nextId++, name, records, files: [], samplePaths: [] };
  state.genomes.push(genome);
  renderGenomes();
  return genome;
}

function renderGenomes() {
  genomeList.replaceChildren();
  state.genomes.forEach((genome, index) => {
    const card = genomeTemplate.content.firstElementChild.cloneNode(true);
    const number = card.querySelector(".genome-number");
    const nameLabel = card.querySelector(".genome-name-label");
    const nameInput = card.querySelector(".genome-name");
    const sequenceLabel = card.querySelector(".sequence-label");
    const sequenceInput = card.querySelector(".sequence-input");
    const fileInput = card.querySelector(".file-input");
    const fileStatus = card.querySelector(".file-status");

    number.textContent = `GENOME ${String(index + 1).padStart(2, "0")}`;
    nameInput.id = `genome-name-${genome.id}`;
    nameLabel.htmlFor = nameInput.id;
    sequenceInput.id = `genome-sequence-${genome.id}`;
    sequenceLabel.htmlFor = sequenceInput.id;
    nameInput.value = genome.name;
    sequenceInput.value = genome.records.join("\n");
    fileInput.id = `genome-files-${genome.id}`;
    card.querySelector(".upload-zone").htmlFor = fileInput.id;
    const fileLabels = genome.files.map((file) => file.name).concat(genome.samplePaths.map((path) => path.split("/").pop()));
    fileStatus.textContent = fileLabels.length
      ? `${fileLabels.length} file${fileLabels.length === 1 ? "" : "s"} selected: ${fileLabels.join(", ")}`
      : "No files selected";

    nameInput.addEventListener("input", () => {
      genome.name = nameInput.value;
      markResultsOutdated();
      updateNullomerChoices();
    });
    sequenceInput.addEventListener("input", () => {
      genome.records = sequenceInput.value ? [sequenceInput.value] : [];
      markResultsOutdated();
    });
    fileInput.addEventListener("change", () => {
      genome.files = [...fileInput.files];
      markResultsOutdated();
      fileStatus.textContent = genome.files.length
        ? `${genome.files.length} file${genome.files.length === 1 ? "" : "s"} selected: ${genome.files.map((file) => file.name).join(", ")}`
        : "No files selected";
    });
    card.querySelector(".remove-genome").addEventListener("click", () => {
      if (state.genomes.length <= 1) {
        showStatus("Keep at least one genome in the list. Add another before removing this one.", true);
        return;
      }
      state.genomes = state.genomes.filter((item) => item.id !== genome.id);
      markResultsOutdated();
      renderGenomes();
      updateNullomerChoices();
    });

    const uploadZone = card.querySelector(".upload-zone");
    uploadZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      uploadZone.classList.add("drag-over");
    });
    uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
    uploadZone.addEventListener("drop", (event) => {
      event.preventDefault();
      uploadZone.classList.remove("drag-over");
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length) {
        genome.files = files;
        markResultsOutdated();
        fileInput.value = "";
        fileStatus.textContent = `${files.length} file${files.length === 1 ? "" : "s"} selected: ${files.map((file) => file.name).join(", ")}`;
      }
    });
    genomeList.append(card);
  });
  updateNullomerChoices();
}

function updateNullomerChoices() {
  const select = document.querySelector("#nullomer-genome");
  const previous = select.value;
  select.replaceChildren();
  state.genomes.forEach((genome, index) => {
    const option = document.createElement("option");
    option.value = String(genome.id);
    option.textContent = genome.name.trim() || `Genome ${index + 1}`;
    select.append(option);
  });
  if (state.genomes.some((genome) => String(genome.id) === previous)) {
    select.value = previous;
  }
}

async function loadExamples() {
  markResultsOutdated();
  state.genomes = sampleGenomes.map((sample) => ({
    id: state.nextId++,
    name: sample.name,
    records: [],
    files: [],
    samplePaths: sample.files,
  }));
  renderGenomes();
  showStatus("Example genomes are selected. Their files will load into your browser when you analyze.");
  document.querySelector("#workspace-title").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function collectGenomes() {
  const selected = [];
  for (const [index, genome] of state.genomes.entries()) {
    const records = genome.records.filter((record) => record.trim());
    for (const file of genome.files) {
      records.push(await file.text());
    }
    for (const path of genome.samplePaths) {
      showStatus(`Loading example sequence ${path.split("/").pop()}…`);
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Could not load ${path} (${response.status}).`);
      }
      records.push(await response.text());
    }
    if (!records.length) continue;
    selected.push({
      id: genome.id,
      name: genome.name.trim() || `Genome ${index + 1}`,
      records,
    });
  }
  if (selected.length < 2) {
    throw new Error("Add sequence data for at least two genomes to compare them.");
  }
  return selected;
}

function runAnalysis() {
  const maxLength = Number(document.querySelector("#max-length").value);
  if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 10) {
    showStatus("Choose a maximum absent-word length between 1 and 10 base pairs.", true);
    return;
  }

  analyzeButton.disabled = true;
  analyzeButton.innerHTML = '<span class="spinner" aria-hidden="true"></span> Preparing sequences…';
  showStatus("Reading sequence files…");
  resultsSection.hidden = true;
  state.result = null;

  collectGenomes()
    .then((genomes) => {
      const targetId = Number(document.querySelector("#nullomer-genome").value);
      const targetGenome = genomes.find((genome) => genome.id === targetId);
      if (!targetGenome) {
        throw new Error("Choose a genome with sequence data for the missing-word search.");
      }
      const worker = new Worker(new URL("./analysis-worker.js", document.baseURI));
      state.worker = worker;
      worker.addEventListener("message", (event) => {
        const message = event.data;
        if (message.type === "progress") {
          showStatus(message.message);
        } else if (message.type === "complete") {
          state.result = { ...message.result, genomes: genomes.map(({ id, name }) => ({ id, name })) };
          renderResults();
          showStatus("Analysis complete. Your sequence data stayed on this device.");
          worker.terminate();
          state.worker = null;
          resetAnalyzeButton();
        } else if (message.type === "error") {
          showStatus(message.message, true);
          worker.terminate();
          state.worker = null;
          resetAnalyzeButton();
        }
      });
      worker.addEventListener("error", (event) => {
        showStatus(`The analysis could not finish. ${event.message || "Try a smaller sequence file."}`, true);
        worker.terminate();
        state.worker = null;
        resetAnalyzeButton();
      });
      worker.postMessage({
        type: "analyze",
        genomes,
        targetName: targetGenome.name,
        maxNullerLength: maxLength,
      });
    })
    .catch((error) => {
      showStatus(error.message, true);
      resetAnalyzeButton();
    });
}

function resetAnalyzeButton() {
  analyzeButton.disabled = false;
  analyzeButton.innerHTML = 'Analyze sequences <span aria-hidden="true">↗</span>';
}

function createSequenceChip(sequence, index, label) {
  const chip = document.createElement("div");
  chip.className = "sequence-chip";
  const text = document.createElement("span");
  text.textContent = sequence;
  const copy = document.createElement("button");
  copy.type = "button";
  copy.setAttribute("aria-label", `Copy ${label} ${index + 1}`);
  copy.title = "Copy sequence";
  copy.textContent = "⧉";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(sequence);
      copy.textContent = "✓";
      copy.setAttribute("aria-label", "Sequence copied");
      window.setTimeout(() => {
        copy.textContent = "⧉";
        copy.setAttribute("aria-label", `Copy ${label} ${index + 1}`);
      }, 1300);
    } catch {
      showStatus("Your browser did not allow copying. Select the sequence text and copy it instead.", true);
    }
  });
  chip.append(text, copy);
  return chip;
}

function renderResults() {
  const result = state.result;
  const common = result.shared.sequences;
  const absent = result.absent;
  const genomeNames = result.genomes.map((genome) => genome.name);
  document.querySelector("#result-summary").textContent =
    `Compared ${genomeNames.length} genomes: ${genomeNames.join(", ")}.`;
  document.querySelector("#shared-length").textContent = String(result.shared.length);
  document.querySelector("#absent-length").textContent = absent.length ? String(absent.length) : "—";
  document.querySelector("#shared-empty").hidden = common.length > 0;
  document.querySelector("#absent-empty").hidden = absent.status === "found";
  document.querySelector("#absent-explainer").textContent =
    absent.status === "limit"
      ? `No absent words were found up to ${result.maxNullerLength} base pairs in ${result.targetName}.`
      : `The shortest words not found in ${result.targetName}.`;

  const sharedList = document.querySelector("#shared-list");
  sharedList.replaceChildren();
  common.forEach((sequence, index) => sharedList.append(createSequenceChip(sequence, index, "shared sequence")));
  const absentList = document.querySelector("#absent-list");
  absentList.replaceChildren();
  absent.words.forEach((sequence, index) => absentList.append(createSequenceChip(sequence, index, "absent word")));
  document.querySelector("#absent-truncated").hidden = absent.count <= absentPreviewLimit;
  if (absent.count > absentPreviewLimit) {
    document.querySelector("#absent-truncated").textContent =
      `Showing the first ${absentPreviewLimit.toLocaleString()} of ${absent.count.toLocaleString()} words. The full list is included in the download.`;
  }
  document.querySelector("#disclaimer").textContent =
    absent.status === "limit"
      ? `No absent word was found through ${result.maxNullerLength} bp. Longer-word search grows exponentially; try a shorter limit, or use a smaller genome.`
      : "This search covers only the sequence records you provided. Reverse complements are treated separately, and ambiguous bases split sequence runs.";

  const selector = document.querySelector("#blast-sequence");
  selector.replaceChildren();
  common.forEach((sequence, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `Shared sequence ${index + 1} (${sequence.length} bp)`;
    selector.append(option);
  });
  document.querySelector("#blast-button").disabled = common.length === 0;
  resultsSection.hidden = false;
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function downloadResults() {
  if (!state.result) return;
  const rows = [["kind", "sequence", "length_bp", "genomes"]];
  const genomeNames = state.result.genomes.map((genome) => genome.name).join("; ");
  for (const sequence of state.result.shared.sequences) {
    rows.push(["longest_shared", sequence, String(sequence.length), genomeNames]);
  }
  for (const sequence of state.result.absent.words) {
    rows.push(["shortest_absent", sequence, String(sequence.length), state.result.targetName]);
  }
  const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "genome-words-results.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function openBlast() {
  const sequenceIndex = Number(document.querySelector("#blast-sequence").value);
  const sequence = state.result?.shared.sequences[sequenceIndex];
  if (!sequence) return;
  const parameters = new URLSearchParams({
    CMD: "Put",
    PROGRAM: "blastn",
    DATABASE: "nt",
    QUERY: `>longest_shared_sequence_${sequenceIndex + 1}\n${sequence}`,
    MEGABLAST: "on",
  });
  window.open(`https://blast.ncbi.nlm.nih.gov/Blast.cgi?${parameters}`, "_blank", "noopener,noreferrer");
}

addGenomeButton.addEventListener("click", () => newGenome());
exampleButton.addEventListener("click", loadExamples);
analyzeButton.addEventListener("click", runAnalysis);
document.querySelector("#download-results").addEventListener("click", downloadResults);
document.querySelector("#blast-button").addEventListener("click", openBlast);
document.querySelector("#nullomer-genome").addEventListener("change", markResultsOutdated);
document.querySelector("#max-length").addEventListener("input", markResultsOutdated);
newGenome();
newGenome();
