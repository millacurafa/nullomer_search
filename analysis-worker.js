"use strict";

self.addEventListener("message", (event) => {
  if (event.data.type !== "analyze") return;
  analyze(event.data)
    .then((result) => self.postMessage({ type: "complete", result }))
    .catch((error) => {
      self.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "An unexpected analysis error occurred.",
      });
    });
});

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function parseSegments(records) {
  const segments = [];
  for (const record of records) {
    let sequence = "";
    let hasHeader = false;
    let sawSequenceBeforeHeader = false;
    const flush = () => {
      for (const run of sequence.toUpperCase().split(/[^ACGT]+/)) {
        if (run) segments.push(run);
      }
      sequence = "";
    };
    for (const line of record.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith(">")) {
        if (!hasHeader && sawSequenceBeforeHeader) {
          flush();
        } else if (hasHeader) {
          flush();
        }
        hasHeader = true;
      } else {
        if (!hasHeader) sawSequenceBeforeHeader = true;
        sequence += trimmed;
      }
    }
    flush();
  }
  return segments;
}

function makeKmerSet(segments, length) {
  const kmers = new Set();
  for (const segment of segments) {
    for (let start = 0; start + length <= segment.length; start += 1) {
      kmers.add(segment.slice(start, start + length));
    }
  }
  return kmers;
}

function findShortestAbsent(segments, maximumLength) {
  for (let length = 1; length <= maximumLength; length += 1) {
    const observed = makeKmerSet(segments, length);
    const total = 4 ** length;
    const words = [];
    const bases = ["A", "C", "G", "T"];
    let absentCount = 0;
    for (let number = 0; number < total; number += 1) {
      let remaining = number;
      let word = "";
      for (let position = 0; position < length; position += 1) {
        word = bases[remaining % 4] + word;
        remaining = Math.floor(remaining / 4);
      }
      if (!observed.has(word)) {
        absentCount += 1;
        words.push(word);
      }
    }
    if (absentCount) return { status: "found", length, count: absentCount, words };
  }
  return { status: "limit", length: null, count: 0, words: [] };
}

async function longestSharedSequences(genomeSegments, reportProgress) {
  const genomeNames = Object.keys(genomeSegments);
  if (genomeNames.length < 2) {
    throw new Error("Add sequence data for at least two genomes to compare them.");
  }
  const names = [...genomeNames].sort(
    (left, right) =>
      genomeSegments[left].reduce((sum, run) => sum + run.length, 0) -
      genomeSegments[right].reduce((sum, run) => sum + run.length, 0),
  );
  const referenceRuns = genomeSegments[names[0]];
  const reference = referenceRuns.join("N");
  const referenceLength = reference.length;
  if (referenceLength > Math.floor((0x7fffffff - 1) / 2)) {
    throw new Error("The shortest genome is too large for this browser to index safely.");
  }

  const capacity = referenceLength * 2 + 1;
  const transition = new Uint32Array(capacity * 5);
  const suffixLink = new Int32Array(capacity);
  const stateLength = new Uint32Array(capacity);
  suffixLink[0] = -1;
  let stateCount = 1;
  let last = 0;
  const baseCode = { A: 0, C: 1, G: 2, T: 3, N: 4 };

  function newState(length, link) {
    if (stateCount >= capacity) {
      throw new Error("Not enough browser memory to index this genome. Try shorter sequence files.");
    }
    const state = stateCount++;
    stateLength[state] = length;
    suffixLink[state] = link;
    return state;
  }

  reportProgress(`Building a compact sequence index (${referenceLength.toLocaleString()} bases)…`);
  for (let position = 0; position < reference.length; position += 1) {
    if (position && position % 500000 === 0) {
      reportProgress(`Building sequence index: ${position.toLocaleString()} / ${referenceLength.toLocaleString()} bases…`);
      await yieldToBrowser();
    }
    const base = reference[position];
    const symbol = baseCode[base];
    const current = newState(stateLength[last] + 1, 0);
    let parent = last;
    while (parent !== -1 && transition[parent * 5 + symbol] === 0) {
      transition[parent * 5 + symbol] = current;
      parent = suffixLink[parent];
    }
    if (parent === -1) {
      suffixLink[current] = 0;
    } else {
      const target = transition[parent * 5 + symbol];
      if (stateLength[parent] + 1 === stateLength[target]) {
        suffixLink[current] = target;
      } else {
        const clone = newState(stateLength[parent] + 1, suffixLink[target]);
        const targetOffset = target * 5;
        const cloneOffset = clone * 5;
        transition.copyWithin(cloneOffset, targetOffset, targetOffset + 5);
        while (parent !== -1 && transition[parent * 5 + symbol] === target) {
          transition[parent * 5 + symbol] = clone;
          parent = suffixLink[parent];
        }
        suffixLink[target] = clone;
        suffixLink[current] = clone;
      }
    }
    last = current;
  }

  const counts = new Uint32Array(referenceLength + 1);
  for (let state = 0; state < stateCount; state += 1) counts[stateLength[state]] += 1;
  for (let length = 1; length < counts.length; length += 1) counts[length] += counts[length - 1];
  const order = new Uint32Array(stateCount);
  for (let state = stateCount - 1; state >= 0; state -= 1) {
    const length = stateLength[state];
    counts[length] -= 1;
    order[counts[length]] = state;
  }
  const commonLength = new Uint32Array(stateCount);
  commonLength.set(stateLength.subarray(0, stateCount));
  let bestMatch = new Uint32Array(stateCount);

  for (const name of names.slice(1)) {
    reportProgress(`Comparing sequences with ${name}…`);
    await yieldToBrowser();
    bestMatch.fill(0);
    let scannedBases = 0;
    for (const segment of genomeSegments[name]) {
      let state = 0;
      let matched = 0;
      for (const base of segment) {
        scannedBases += 1;
        if (scannedBases % 500000 === 0) {
          reportProgress(`Comparing sequences with ${name}: ${scannedBases.toLocaleString()} bases…`);
          await yieldToBrowser();
        }
        const symbol = baseCode[base];
        while (state !== 0 && transition[state * 5 + symbol] === 0) {
          state = suffixLink[state];
          matched = Math.min(matched, stateLength[state]);
        }
        const target = transition[state * 5 + symbol];
        if (target !== 0) {
          state = target;
          matched += 1;
          if (matched > bestMatch[state]) bestMatch[state] = matched;
        } else {
          state = 0;
          matched = 0;
        }
      }
    }
    for (let index = stateCount - 1; index > 0; index -= 1) {
      const state = order[index];
      const parent = suffixLink[state];
      const propagated = Math.min(bestMatch[state], stateLength[parent]);
      if (propagated > bestMatch[parent]) bestMatch[parent] = propagated;
    }
    for (let state = 0; state < stateCount; state += 1) {
      if (bestMatch[state] < commonLength[state]) commonLength[state] = bestMatch[state];
    }
  }

  let longestLength = 0;
  for (const length of commonLength) longestLength = Math.max(longestLength, length);
  if (longestLength === 0) return { length: 0, sequences: [] };

  const canonicalState = new Uint32Array(stateCount);
  for (let index = 0; index < stateCount; index += 1) {
    const state = order[index];
    const parent = suffixLink[state];
    canonicalState[state] =
      parent >= 0 && stateLength[parent] >= longestLength
        ? canonicalState[parent]
        : state;
  }

  const sequences = new Set();
  let extractedBases = 0;
  for (const segment of referenceRuns) {
    let state = 0;
    let matched = 0;
    for (let end = 0; end < segment.length; end += 1) {
      extractedBases += 1;
      if (extractedBases % 500000 === 0) {
        reportProgress(`Collecting longest shared sequences: ${extractedBases.toLocaleString()} bases…`);
        await yieldToBrowser();
      }
      const symbol = baseCode[segment[end]];
      while (state !== 0 && transition[state * 5 + symbol] === 0) {
        state = suffixLink[state];
        matched = Math.min(matched, stateLength[state]);
      }
      const target = transition[state * 5 + symbol];
      if (target !== 0) {
        state = target;
        matched += 1;
        if (
          matched >= longestLength &&
          commonLength[canonicalState[state]] >= longestLength
        ) {
          sequences.add(segment.slice(end - longestLength + 1, end + 1));
        }
      } else {
        state = 0;
        matched = 0;
      }
    }
  }
  return { length: longestLength, sequences: [...sequences].sort() };
}

async function analyze({ genomes, targetName, maxNullerLength }) {
  if (!Array.isArray(genomes) || genomes.length < 2) {
    throw new Error("Add sequence data for at least two genomes to compare them.");
  }
  if (!Number.isInteger(maxNullerLength) || maxNullerLength < 1 || maxNullerLength > 10) {
    throw new Error("Choose a maximum absent-word length between 1 and 10 base pairs.");
  }
  const parsed = {};
  const summaries = [];
  for (const genome of genomes) {
    const segments = parseSegments(genome.records);
    if (!segments.length) {
      throw new Error(`No A, C, G, or T bases were found in ${genome.name}.`);
    }
    parsed[genome.name] = segments;
    summaries.push({
      name: genome.name,
      bases: segments.reduce((sum, segment) => sum + segment.length, 0),
      runs: segments.length,
    });
  }
  if (new Set(genomes.map((genome) => genome.name)).size !== genomes.length) {
    throw new Error("Give each genome a different name so results are easy to interpret.");
  }
  const actualTarget = parsed[targetName] ? targetName : genomes[0].name;
  const absentSegments = parsed[actualTarget];
  const totalBases = summaries.reduce((sum, item) => sum + item.bases, 0);
  self.postMessage({
    type: "progress",
    message: `Found ${totalBases.toLocaleString()} valid DNA bases across ${genomes.length} genomes. Starting the analysis…`,
  });
  const absent = findShortestAbsent(absentSegments, maxNullerLength);
  const shared = await longestSharedSequences(parsed, (message) =>
    self.postMessage({ type: "progress", message }),
  );
  return {
    shared,
    absent,
    targetName: actualTarget,
    maxNullerLength,
    summaries,
  };
}
