/* ==========================================================================
   CACHELAB - COMPUTER ARCHITECTURE CACHE MEMORY SIMULATOR
   Department of Computer Science & Engineering (AI & ML)
   Mini-Project: Computer Organization & Architecture (COA)
   Technologies: Semantic HTML5, Modern CSS3, Vanilla JavaScript (ES6+ Strict)
   ========================================================================== */

"use strict";

// 1. DOM ELEMENT SELECTOR HELPER
const $ = (id) => document.getElementById(id);

// 2. SIMULATION STATE VARIABLES
let cache = [];
let totalAccesses = 0;
let cacheHits = 0;
let cacheMisses = 0;
let clock = 0;

// Miss Taxonomy (The 3 C's)
let compulsoryMisses = 0;
let conflictMisses = 0;
let capacityMisses = 0;
let accessedBlocksSet = new Set();

// Memory Access Sequence & Step Control
let sequence = [];
let sequenceIndex = 0;
let autoPlayTimer = null;

// History & Active Row Highlighting
let history = [];
let lastAccessedLine = null;
let lastResultType = null;
let lastCandidates = [];

// 3. HARDWARE CONFIGURATION PARSER & VALIDATOR
function getConfig() {
    const lines = Number($("cacheSize").value);
    const blockSize = Number($("blockSize").value);
    const mapping = $("mapping").value;
    const ways = Number($("ways").value);
    const policy = $("policy").value;

    if (!Number.isInteger(lines) || lines <= 0) {
        throw new Error("Invalid cache size configuration.");
    }

    if (!Number.isInteger(blockSize) || blockSize <= 0) {
        throw new Error("Invalid block size configuration.");
    }

    if (mapping === "set") {
        if (!Number.isInteger(ways) || ways <= 0 || ways > lines || lines % ways !== 0) {
            throw new Error(`Cache lines (${lines}) must be evenly divisible by ways per set (${ways}).`);
        }
    }

    return {
        lines,
        blockSize,
        mapping,
        ways,
        policy
    };
}

// Dynamically adjust "Ways per Set" dropdown options based on cache lines
function updateWaysOptions() {
    const lines = Number($("cacheSize").value);
    const waysSelect = $("ways");
    if (!waysSelect) return;

    const currentWays = Number(waysSelect.value);
    waysSelect.innerHTML = "";

    const candidateWays = [2, 4, 8, 16].filter(w => w <= lines && lines % w === 0);

    candidateWays.forEach(w => {
        const opt = document.createElement("option");
        opt.value = w;
        opt.textContent = `${w}-Way Associative`;
        if (w === currentWays || (currentWays > lines && w === candidateWays[0])) {
            opt.selected = true;
        }
        waysSelect.appendChild(opt);
    });

    if (!candidateWays.includes(currentWays) && candidateWays.length > 0) {
        waysSelect.value = candidateWays[0];
    }
}

// 4. CACHE MEMORY INITIALIZATION
function initializeCache() {
    const config = getConfig();

    cache = Array.from(
        { length: config.lines },
        () => ({
            valid: false,
            tag: null,
            block: null,
            inserted: 0,
            lastUsed: 0,
            accessCount: 0
        })
    );

    lastAccessedLine = null;
    lastResultType = null;
    lastCandidates = [];
}

// 5. RESET SIMULATION STATE
function resetSimulation() {
    stopAutoPlay();

    try {
        initializeCache();
    } catch (error) {
        showMessage(error.message, "miss");
        return;
    }

    totalAccesses = 0;
    cacheHits = 0;
    cacheMisses = 0;
    clock = 0;

    compulsoryMisses = 0;
    conflictMisses = 0;
    capacityMisses = 0;
    accessedBlocksSet.clear();

    sequence = [];
    sequenceIndex = 0;
    history = [];

    const seqStatus = $("sequenceStatus");
    if (seqStatus) {
        seqStatus.textContent = "No sequence loaded. Enter addresses or select a preset above.";
    }

    const cacheStatus = $("cacheStatus");
    if (cacheStatus) {
        cacheStatus.textContent = "Waiting for access";
    }

    const sysStatus = $("systemStatus");
    if (sysStatus) {
        sysStatus.textContent = "System Ready";
    }

    const result = $("result");
    if (result) {
        result.className = "result-box";
        result.textContent = "Simulation reset. Enter a memory address or trace sequence.";
    }

    const resultBadge = $("resultBadge");
    if (resultBadge) {
        resultBadge.className = "result-badge-idle";
        resultBadge.textContent = "READY";
    }

    // Reset visual placeholders
    const analysisPanel = $("analysisContent");
    if (analysisPanel) {
        analysisPanel.innerHTML = '<div class="analysis-placeholder">Submit a memory address to view the complete 7-step architectural derivation.</div>';
    }

    const binaryPanel = $("binaryContent");
    if (binaryPanel) {
        binaryPanel.innerHTML = '<div class="analysis-placeholder">Access a memory address to inspect its binary bit slicing across Tag, Index, and Offset fields.</div>';
    }

    const memoryFlow = $("memoryFlowContent");
    if (memoryFlow) {
        memoryFlow.innerHTML = '<div class="flow-placeholder"><div class="flow-placeholder-icon">🖥️ ⟷ ⚡ ⟷ 💾</div><p>Access a memory address to activate the hardware data flow animation and bus transaction monitor.</p></div>';
    }

    const comparisonContainer = $("comparisonContainer");
    if (comparisonContainer) {
        comparisonContainer.style.display = "none";
    }

    updateDashboard();
    renderHistory();
}

// 6. ARCHITECTURAL CALCULATIONS
function getMemoryBlock(address, blockSize) {
    return Math.floor(address / blockSize);
}

function getSetNumber(block, config) {
    const totalSets = config.lines / config.ways;
    return block % totalSets;
}

function getCandidateLines(block, config) {
    // Direct Mapping: Block maps to exactly (Block mod Lines)
    if (config.mapping === "direct") {
        return [block % config.lines];
    }

    // Fully Associative Mapping: Block can reside in any cache line
    if (config.mapping === "associative") {
        return cache.map((_, index) => index);
    }

    // Set-Associative Mapping: Block maps to a specific set
    if (config.mapping === "set") {
        const setNumber = getSetNumber(block, config);
        const start = setNumber * config.ways;
        return Array.from({ length: config.ways }, (_, index) => start + index);
    }

    return [];
}

function findCacheBlock(block, candidates) {
    return candidates.find(index => {
        return cache[index].valid && cache[index].block === block;
    });
}

function selectReplacementLine(candidates, policy) {
    // Priority 1: Use an invalid (empty) cache line if available
    const emptyLine = candidates.find(index => !cache[index].valid);
    if (emptyLine !== undefined) {
        return emptyLine;
    }

    // FIFO: Replace earliest inserted block
    if (policy === "FIFO") {
        return candidates.reduce((oldest, current) => {
            return cache[current].inserted < cache[oldest].inserted ? current : oldest;
        });
    }

    // LRU: Replace least recently used block
    if (policy === "LRU") {
        return candidates.reduce((leastUsed, current) => {
            return cache[current].lastUsed < cache[leastUsed].lastUsed ? current : leastUsed;
        });
    }

    // LFU: Replace least frequently used block (tie-breaker: FIFO)
    if (policy === "LFU") {
        return candidates.reduce((minFreq, current) => {
            if (cache[current].accessCount < cache[minFreq].accessCount) {
                return current;
            } else if (cache[current].accessCount === cache[minFreq].accessCount) {
                return cache[current].inserted < cache[minFreq].inserted ? current : minFreq;
            }
            return minFreq;
        });
    }

    return candidates[0];
}

function calculateTag(block, config) {
    if (config.mapping === "direct") {
        return Math.floor(block / config.lines);
    }

    if (config.mapping === "set") {
        const totalSets = config.lines / config.ways;
        return Math.floor(block / totalSets);
    }

    // Fully Associative: Tag is the entire block number
    return block;
}

// Latency Profile Helper
function getLatencyProfile() {
    const el = $("latencyProfile");
    if (!el) return { hitTime: 1, missPenalty: 20 };
    const parts = el.value.split(",").map(Number);
    return {
        hitTime: parts[0] || 1,
        missPenalty: parts[1] || 20
    };
}

// 7. STEP-BY-STEP CACHE ANALYSIS RENDERER
function renderAccessAnalysis(data) {
    const {
        address,
        block,
        offset,
        config,
        candidates,
        foundLine,
        lineNumber,
        replacedBlock,
        resultType,
        missClassification,
        oldHits,
        oldMisses
    } = data;

    const totalSets = config.lines / config.ways;
    let mappingFormula = "";
    let mappingExplanation = "";

    if (config.mapping === "direct") {
        const index = block % config.lines;
        const tag = Math.floor(block / config.lines);
        mappingFormula = `Line = Block mod CacheLines = ${block} mod ${config.lines} = Line ${index}`;
        mappingExplanation = `In Direct Mapping, block ${block} maps strictly to cache line ${index}. Hardware calculates Tag = ⌊Block / Lines⌋ = ⌊${block} / ${config.lines}⌋ = ${tag}.`;
    } else if (config.mapping === "associative") {
        mappingFormula = `Fully Associative: Tag = Block = ${block} (All ${config.lines} lines evaluated in parallel)`;
        mappingExplanation = `In Fully Associative Mapping, there are no set/index bits. Block ${block} can be allocated in any available cache line.`;
    } else {
        const setNumber = getSetNumber(block, config);
        const tag = Math.floor(block / totalSets);
        mappingFormula = `Set = Block mod TotalSets = ${block} mod ${totalSets} = Set ${setNumber}`;
        mappingExplanation = `In ${config.ways}-Way Set Associative, block ${block} maps to Set ${setNumber}. It can reside in any of the ${config.ways} lines belonging to Set ${setNumber} (Lines: ${candidates.join(", ")}). Calculated Tag = ${tag}.`;
    }

    const panel = $("analysisContent");
    if (!panel) return;
    panel.innerHTML = "";

    function addStep(title, paragraphs, formula = null, isHit = false, isMiss = false) {
        const card = document.createElement("div");
        card.className = "analysis-step" + (isHit ? " hit-step" : "") + (isMiss ? " miss-step" : "");

        const heading = document.createElement("h3");
        heading.innerHTML = `<span>${title}</span>`;
        card.appendChild(heading);

        paragraphs.forEach(text => {
            const p = document.createElement("p");
            p.innerHTML = text;
            card.appendChild(p);
        });

        if (formula) {
            const fBox = document.createElement("div");
            fBox.className = "analysis-formula-box";
            fBox.textContent = formula;
            card.appendChild(fBox);
        }

        panel.appendChild(card);
    }

    // Step 1: Memory Address Request
    addStep(
        "STEP 1: Processor Request & Address Parsing",
        [
            `CPU generated read request for memory address: <strong>${address}</strong> (Hex: <code>0x${address.toString(16).toUpperCase()}</code>).`,
            `Cache architecture parameter: Block Size = <strong>${config.blockSize} word(s)</strong>.`
        ]
    );

    // Step 2: Block & Offset Calculation
    addStep(
        "STEP 2: Memory Block & Word Offset Identification",
        [
            `Continuous memory is segmented into blocks of size ${config.blockSize}.`,
            `Calculated Memory Block: <strong>Block ${block}</strong>, Offset within block: <strong>Word ${offset}</strong>.`
        ],
        `Block = ⌊Address / BlockSize⌋ = ⌊${address} / ${config.blockSize}⌋ = ${block} | Offset = Address % BlockSize = ${address} % ${config.blockSize} = ${offset}`
    );

    // Step 3: Mapping & Candidate Lines
    addStep(
        "STEP 3: Cache Set & Line Mapping",
        [
            `Selected Mapping Technique: <strong>${config.mapping === "set" ? `${config.ways}-Way Set Associative` : config.mapping === "direct" ? "Direct Mapping" : "Fully Associative"}</strong>.`,
            mappingExplanation,
            `Candidate cache lines inspected by control unit: <strong>[${candidates.join(", ")}]</strong>.`
        ],
        mappingFormula
    );

    // Step 4: Tag Comparator Search
    const tagVal = calculateTag(block, config);
    addStep(
        "STEP 4: Tag Extraction & Comparator Search",
        [
            `Hardware extracts Tag value: <strong>${tagVal}</strong>.`,
            `The cache controller checks valid bits and compares Tag ${tagVal} against stored tags in candidate line(s): ${candidates.join(", ")}.`,
            foundLine !== undefined
                ? `<strong>Tag Comparator Match:</strong> Found matching Tag ${tagVal} with Valid Bit = 1 in Line ${foundLine}.`
                : `<strong>Tag Comparator Mismatch:</strong> No valid candidate line contained Tag ${tagVal}.`
        ]
    );

    // Step 5: Hit / Miss Decision & Miss Classification
    if (resultType === "hit") {
        addStep(
            "STEP 5: Cache Search Result: CACHE HIT ✓",
            [
                `The requested block was already resident in cache line <strong>Line ${foundLine}</strong>.`,
                `Word offset ${offset} is extracted directly from the cache line and forwarded to the CPU.`,
                `Main Memory was <strong>NOT</strong> accessed, saving bus bandwidth and preventing memory stall cycles.`
            ],
            null,
            true,
            false
        );
    } else {
        const missExplanation = missClassification === "Compulsory"
            ? `<strong>Compulsory (Cold) Miss:</strong> This memory block (Block ${block}) was accessed for the very first time since simulation reset. It could not have been in cache previously.`
            : missClassification === "Capacity"
                ? `<strong>Capacity Miss:</strong> All ${config.lines} lines of the cache are fully occupied. The cache cannot contain the working set of blocks.`
                : `<strong>Conflict Miss:</strong> Contention occurred in the designated set/line. Multiple active memory blocks map to the same set even though other sets/lines in cache may have free capacity.`;

        addStep(
            `STEP 5: Cache Search Result: CACHE MISS ✕ (${missClassification} Miss)`,
            [
                `The requested data was <strong>ABSENT</strong> from cache.`,
                `Miss Classification: <strong>${missClassification} Miss</strong>.`,
                missExplanation,
                `Control unit initiates an external bus read transaction to fetch the entire Block ${block} from Main Memory.`
            ],
            null,
            false,
            true
        );
    }

    // Step 6: Allocation & Replacement Policy
    if (resultType === "hit") {
        addStep(
            "STEP 6: Cache State Update",
            [
                `No line allocation or block replacement was necessary.`,
                `Line ${foundLine} timestamp updated: Last Used = Clock cycle <strong>${clock}</strong>, Access Count = <strong>${cache[foundLine].accessCount}</strong>.`
            ]
        );
    } else {
        const replText = replacedBlock === null
            ? `An unallocated line (Line ${lineNumber}) was available (Valid = 0). Block ${block} was loaded into Line ${lineNumber} without evicting existing data.`
            : `Candidate set lines were fully occupied. Applied <strong>${config.policy}</strong> replacement policy: evicted victim <strong>Block ${replacedBlock}</strong> from Line ${lineNumber} to store new Block ${block}.`;

        addStep(
            `STEP 6: Block Allocation & Eviction (${config.policy})`,
            [
                replText,
                `Line ${lineNumber} initialized with Valid = 1, Tag = ${tagVal}, Memory Block = ${block}, Insertion Timestamp = t=${clock}.`
            ]
        );
    }

    // Step 7: Performance Impact & AMAT
    const newHits = oldHits + (resultType === "hit" ? 1 : 0);
    const newMisses = oldMisses + (resultType === "miss" ? 1 : 0);
    const newTotal = newHits + newMisses;
    const hitRatio = (newHits / newTotal) * 100;
    const missRatio = (newMisses / newTotal) * 100;
    const { hitTime, missPenalty } = getLatencyProfile();
    const amat = hitTime + ((newMisses / newTotal) * missPenalty);

    addStep(
        "STEP 7: Performance & Latency Analytics",
        [
            `Updated Totals: Accesses = <strong>${newTotal}</strong> | Hits = <strong>${newHits}</strong> | Misses = <strong>${newMisses}</strong>.`,
            `Hit Ratio = <strong>${hitRatio.toFixed(2)}%</strong> | Miss Ratio = <strong>${missRatio.toFixed(2)}%</strong>.`,
            `Average Memory Access Time: <strong>AMAT = ${amat.toFixed(2)} cycles</strong> (Hit Time: ${hitTime}c, Miss Penalty: ${missPenalty}c).`
        ],
        `AMAT = ${hitTime} + (${(newMisses / newTotal).toFixed(4)} × ${missPenalty}) = ${amat.toFixed(2)} cycles`
    );
}

// 8. HARDWARE DATA FLOW (CPU - CACHE - MAIN MEMORY)
function renderMemoryFlow(address, block, resultType) {
    const panel = $("memoryFlowContent");
    if (!panel) return;

    const isHit = resultType === "hit";
    const statusClass = isHit ? "hit-status" : "miss-status";
    const cpuNodeClass = isHit ? "active-hit" : "active-miss";
    const cacheNodeClass = isHit ? "active-hit" : "active-miss";

    const statusTitle = isHit ? "✓ CACHE HIT: Fast Service via L1 Cache" : "✕ CACHE MISS: Main Memory Bus Fetch Required";
    const explanation = isHit
        ? `Block ${block} is currently cached in L1. The CPU read was serviced immediately in 1 cycle without initiating any system bus traffic to Main Memory.`
        : `Block ${block} was not found in L1 cache. The cache controller issued an external memory read on the system bus. Main Memory transferred the ${getConfig().blockSize}-word block across the bus to refill the cache line.`;

    const steps = isHit
        ? [
            "1. CPU places Address " + address + " on the internal L1 address bus.",
            "2. Cache controller extracts Tag and checks candidate lines in parallel.",
            "3. Tag matched with valid bit = 1: CACHE HIT.",
            "4. Cache data multiplexer forwards requested word directly to CPU in 1 clock cycle.",
            "5. Main Memory bus remains idle; 0 memory stall cycles incurred."
        ]
        : [
            "1. CPU places Address " + address + " on the internal L1 address bus.",
            "2. Cache controller extracts Tag and checks candidate lines.",
            "3. No tag match found: CACHE MISS signaled.",
            "4. Memory controller stalls CPU and initiates bus read request to Main Memory.",
            "5. Main Memory transfers full Block " + block + " across system bus to L1 cache.",
            "6. Cache line allocated/refilled; requested word forwarded to CPU."
        ];

    panel.innerHTML = `
        <div class="memory-flow">
            <div class="memory-node ${cpuNodeClass}" id="cpuNode">
                <div class="node-icon">🖥️</div>
                <h3>CPU Core</h3>
                <p>Requesting Address <strong>${address}</strong><br><small>Hex: 0x${address.toString(16).toUpperCase()}</small></p>
            </div>

            <div class="flow-arrow animating ${isHit ? "hit-arrow" : "miss-arrow"}" id="cpuCacheArrow">
                <div class="flow-dot"></div>
                <div class="flow-arrow-graphic">${isHit ? "⟵" : "⟶"}</div>
                <span>${isHit ? "Data to CPU (1 cycle)" : "Address Lookup"}</span>
            </div>

            <div class="memory-node ${cacheNodeClass}" id="cacheNode">
                <div class="node-icon">⚡</div>
                <h3>L1 Cache Memory</h3>
                <p>Block <strong>${block}</strong><br><small>${isHit ? "Tag Match: HIT" : "Tag Mismatch: MISS"}</small></p>
            </div>

            <div class="flow-arrow ${isHit ? "" : "animating miss-arrow"}" id="ramCacheArrow">
                <div class="flow-dot"></div>
                <div class="flow-arrow-graphic">${isHit ? "—" : "⟵"}</div>
                <span>${isHit ? "RAM Idle (No Bus Traffic)" : "Block Fill via Bus"}</span>
            </div>

            <div class="memory-node ${isHit ? "" : "active-miss"}" id="ramNode">
                <div class="node-icon">💾</div>
                <h3>Main Memory (RAM)</h3>
                <p>${isHit ? "Not Accessed (0 Stall)" : `Supplied Block ${block}`}<br><small>${isHit ? "Power Saved" : "Miss Penalty Incurred"}</small></p>
            </div>
        </div>

        <div class="flow-status-banner ${statusClass}">
            <h3>${statusTitle}</h3>
            <p>${explanation}</p>
        </div>

        <div class="flow-steps-list">
            <strong>Microarchitectural Transaction Sequence:</strong>
            ${steps.map(s => `<div>${s}</div>`).join("")}
        </div>
    `;

    // Trigger visual reflow for animation restart
    const cpu = $("cpuNode");
    const cacheNode = $("cacheNode");
    const ram = $("ramNode");
    const firstArrow = $("cpuCacheArrow");
    const secondArrow = $("ramCacheArrow");

    [cpu, cacheNode, ram, firstArrow, secondArrow].forEach(el => {
        if (el) {
            el.style.animation = "none";
            void el.offsetWidth;
            el.style.animation = "";
        }
    });
}

// 9. BINARY ADDRESS DECOMPOSITION RENDERER
function renderBinaryAddress(address, config) {
    const panel = $("binaryContent");
    if (!panel) return;

    const blockSize = config.blockSize;
    const cacheLines = config.lines;

    const isPowerOfTwo = n => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
    const numberOfSets = config.mapping === "set" ? cacheLines / config.ways : cacheLines;

    if (!isPowerOfTwo(blockSize) || (config.mapping !== "associative" && !isPowerOfTwo(numberOfSets))) {
        panel.innerHTML = '<div class="analysis-placeholder">Binary address breakdown requires power-of-two parameters for block size and number of sets.</div>';
        return;
    }

    const offsetBits = Math.log2(blockSize);
    let indexBits = 0;

    if (config.mapping === "direct") {
        indexBits = Math.log2(cacheLines);
    } else if (config.mapping === "set") {
        indexBits = Math.log2(numberOfSets);
    }

    const addressBits = Math.max(8, Math.ceil(Math.log2(address + 1) || 1), offsetBits + indexBits + 1);
    const binary = address.toString(2).padStart(addressBits, "0");

    const tagBits = addressBits - indexBits - offsetBits;
    const tagBin = binary.substring(0, tagBits);
    const indexBin = indexBits > 0 ? binary.substring(tagBits, tagBits + indexBits) : "";
    const offsetBin = offsetBits > 0 ? binary.substring(tagBits + indexBits) : "";

    const tagDec = parseInt(tagBin, 2) || 0;
    const indexDec = indexBits > 0 ? parseInt(indexBin, 2) : "N/A";
    const offsetDec = offsetBits > 0 ? parseInt(offsetBin, 2) : 0;
    const block = Math.floor(address / blockSize);

    // Bit ranges
    const tagRange = `[${addressBits - 1} : ${addressBits - tagBits}]`;
    const indexRange = indexBits > 0 ? `[${addressBits - tagBits - 1} : ${offsetBits}]` : "None";
    const offsetRange = offsetBits > 0 ? `[${offsetBits - 1} : 0]` : "None";

    panel.innerHTML = `
        <div class="binary-card-wrap">
            <div class="binary-header-stats">
                <div class="binary-stat-box">
                    <small>Decimal Address</small>
                    <strong>${address}</strong>
                </div>
                <div class="binary-stat-box">
                    <small>Hexadecimal</small>
                    <strong>0x${address.toString(16).toUpperCase()}</strong>
                </div>
                <div class="binary-stat-box">
                    <small>Memory Block</small>
                    <strong>Block ${block}</strong>
                </div>
                <div class="binary-stat-box">
                    <small>Address Register Width</small>
                    <strong>${addressBits} bits</strong>
                </div>
            </div>

            <div class="binary-register">
                <div class="binary-field tag-field">
                    <div class="field-header">
                        <h3>TAG</h3>
                        <span class="field-bits">${tagBits} bits ${tagRange}</span>
                    </div>
                    <div class="field-binary-value">${tagBin}</div>
                    <div class="field-decimal-value">Decimal Value = <strong>${tagDec}</strong></div>
                </div>

                <div class="binary-field index-field">
                    <div class="field-header">
                        <h3>INDEX (SET / LINE)</h3>
                        <span class="field-bits">${indexBits} bits ${indexRange}</span>
                    </div>
                    <div class="field-binary-value">${indexBits > 0 ? indexBin : "—"}</div>
                    <div class="field-decimal-value">${indexBits > 0 ? `Set/Line Index = <strong>${indexDec}</strong>` : "<em>N/A (Fully Associative)</em>"}</div>
                </div>

                <div class="binary-field offset-field">
                    <div class="field-header">
                        <h3>WORD OFFSET</h3>
                        <span class="field-bits">${offsetBits} bits ${offsetRange}</span>
                    </div>
                    <div class="field-binary-value">${offsetBits > 0 ? offsetBin : "—"}</div>
                    <div class="field-decimal-value">${offsetBits > 0 ? `Word Offset = <strong>${offsetDec}</strong>` : "<em>0 bits (1 Word/Block)</em>"}</div>
                </div>
            </div>

            <div class="binary-formula-card">
                <strong>Hardware Slicing Verification:</strong><br>
                <span>Full Binary: <code class="code-chip">${binary}</code> (Length: ${addressBits} bits)</span><br>
                <span>Reconstruction: <code>(Tag &lt;&lt; ${indexBits + offsetBits}) | (${indexBits > 0 ? "Index" : "0"} &lt;&lt; ${offsetBits}) | Offset = (${tagDec} &lt;&lt; ${indexBits + offsetBits}) | (${indexDec === "N/A" ? 0 : indexDec} &lt;&lt; ${offsetBits}) | ${offsetDec} = ${address}</code>.</span>
            </div>
        </div>
    `;
}

// 10. MAIN MEMORY ACCESS CONTROLLER
function accessMemory(rawAddress) {
    let address;

    if (typeof rawAddress === "string") {
        const trimmed = rawAddress.trim();
        if (trimmed === "") {
            showMessage("Please enter a memory address to access.", "miss");
            return;
        }

        if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
            if (!/^0x[0-9a-fA-F]+$/i.test(trimmed)) {
                showMessage(`Invalid hexadecimal address "${trimmed}". Please use valid hex digits 0-9, A-F (e.g. 0x0C, 0x1A).`, "miss");
                return;
            }
            address = parseInt(trimmed, 16);
        } else {
            if (!/^\d+$/.test(trimmed)) {
                showMessage(`Invalid address "${trimmed}". Please enter a valid non-negative integer number (e.g. 12, 45).`, "miss");
                return;
            }
            address = Number(trimmed);
        }
    } else {
        address = Number(rawAddress);
    }

    if (!Number.isSafeInteger(address) || address < 0) {
        showMessage("Please enter a valid non-negative integer or hexadecimal memory address (e.g. 12 or 0x0C).", "miss");
        return;
    }

    let config;
    try {
        config = getConfig();
    } catch (error) {
        showMessage(error.message, "miss");
        return;
    }

    const block = getMemoryBlock(address, config.blockSize);
    const offset = address % config.blockSize;
    const candidates = getCandidateLines(block, config);

    clock++;
    totalAccesses++;

    const existingLine = findCacheBlock(block, candidates);
    const previousHits = cacheHits;
    const previousMisses = cacheMisses;

    let message;
    let resultType;
    let replacedBlock = null;
    let lineNumber;
    let missClassification = null;

    if (existingLine !== undefined) {
        // CACHE HIT
        cacheHits++;
        lineNumber = existingLine;
        cache[existingLine].lastUsed = clock;
        cache[existingLine].accessCount = (cache[existingLine].accessCount || 0) + 1;

        resultType = "hit";
        message = `CACHE HIT! Requested address ${address} (Block ${block}, Word Offset ${offset}) was found in Cache Line ${existingLine}.`;

        const cacheStatus = $("cacheStatus");
        if (cacheStatus) cacheStatus.textContent = "Cache Hit!";

        const sysStatus = $("systemStatus");
        if (sysStatus) sysStatus.textContent = "Hit in L1 Cache";
    } else {
        // CACHE MISS
        cacheMisses++;

        // Determine 3C Miss Classification
        if (!accessedBlocksSet.has(block)) {
            missClassification = "Compulsory";
            compulsoryMisses++;
        } else if (cache.every(line => line.valid)) {
            missClassification = "Capacity";
            capacityMisses++;
        } else {
            missClassification = "Conflict";
            conflictMisses++;
        }
        accessedBlocksSet.add(block);

        const victimLine = selectReplacementLine(candidates, config.policy);
        lineNumber = victimLine;

        if (cache[victimLine].valid) {
            replacedBlock = cache[victimLine].block;
        }

        cache[victimLine] = {
            valid: true,
            tag: calculateTag(block, config),
            block: block,
            inserted: clock,
            lastUsed: clock,
            accessCount: 1
        };

        resultType = "miss";
        message = `CACHE MISS (${missClassification})! Block ${block} was fetched from Main Memory and loaded into Cache Line ${victimLine}.`;
        if (replacedBlock !== null) {
            message += ` Previous Block ${replacedBlock} was evicted using ${config.policy}.`;
        }

        const cacheStatus = $("cacheStatus");
        if (cacheStatus) cacheStatus.textContent = "Main Memory → Cache";

        const sysStatus = $("systemStatus");
        if (sysStatus) sysStatus.textContent = "Memory Bus Active";
    }

    lastAccessedLine = lineNumber;
    lastResultType = resultType;
    lastCandidates = candidates;

    // Update Result Box & Result Badge
    showMessage(message, resultType);
    const resultBadge = $("resultBadge");
    if (resultBadge) {
        resultBadge.className = resultType === "hit" ? "result-badge-hit" : "result-badge-miss";
        resultBadge.textContent = resultType === "hit" ? "CACHE HIT" : `MISS (${missClassification.toUpperCase()})`;
    }

    // Update Dynamic Visualizations
    renderBinaryAddress(address, config);
    renderMemoryFlow(address, block, resultType);

    // Save Access History
    history.unshift({
        access: totalAccesses,
        address,
        hex: "0x" + address.toString(16).toUpperCase(),
        block,
        offset,
        line: lineNumber,
        set: config.mapping === "set" ? Math.floor(lineNumber / config.ways) : "-",
        tag: calculateTag(block, config),
        result: resultType.toUpperCase(),
        missType: missClassification || "—",
        policy: config.policy,
        replacedBlock: replacedBlock !== null ? replacedBlock : "—"
    });

    // Render Step-by-Step Mathematical Analysis
    renderAccessAnalysis({
        address,
        block,
        offset,
        config,
        candidates,
        foundLine: existingLine,
        lineNumber,
        replacedBlock,
        resultType,
        missClassification,
        oldHits: previousHits,
        oldMisses: previousMisses
    });

    // Update KPI Dashboard, Tables & Performance Bar
    updateDashboard();
    renderHistory();
}

// 11. SHOW RESULT CALLOUT
function showMessage(message, type) {
    const result = $("result");
    if (!result) return;
    result.className = "result-box " + type;
    result.textContent = message;
}

// 12. UPDATE PERFORMANCE DASHBOARD METRICS
function updateDashboard() {
    const total = totalAccesses;
    const hitRatio = total > 0 ? (cacheHits / total) * 100 : 0;
    const missRatio = total > 0 ? (cacheMisses / total) * 100 : 0;

    if ($("total")) $("total").textContent = String(total);
    if ($("hits")) $("hits").textContent = String(cacheHits);
    if ($("misses")) $("misses").textContent = String(cacheMisses);
    if ($("hitRatio")) $("hitRatio").textContent = hitRatio.toFixed(2) + "%";
    if ($("missRatio")) $("missRatio").textContent = missRatio.toFixed(2) + "%";

    // AMAT Metric
    const { hitTime, missPenalty } = getLatencyProfile();
    const amat = total > 0 ? hitTime + ((cacheMisses / total) * missPenalty) : hitTime;
    if ($("amatMetric")) $("amatMetric").textContent = amat.toFixed(2);

    // Progress Bar
    if ($("hitPercent")) $("hitPercent").textContent = hitRatio.toFixed(2) + "%";
    if ($("progressBar")) {
        $("progressBar").style.width = hitRatio + "%";
        $("progressBar").style.background = hitRatio >= 50
            ? "linear-gradient(90deg, #38bdf8, #10b981)"
            : "linear-gradient(90deg, #f43f5e, #fbbf24)";
    }

    // Ratio Distribution Bar
    if ($("ratioHitBar") && $("ratioMissBar")) {
        if (total === 0) {
            $("ratioHitBar").style.width = "50%";
            $("ratioMissBar").style.width = "50%";
            if ($("ratioHitText")) $("ratioHitText").textContent = "0 (0%)";
            if ($("ratioMissText")) $("ratioMissText").textContent = "0 (0%)";
        } else {
            $("ratioHitBar").style.width = hitRatio + "%";
            $("ratioMissBar").style.width = missRatio + "%";
            if ($("ratioHitText")) $("ratioHitText").textContent = `${cacheHits} (${hitRatio.toFixed(1)}%)`;
            if ($("ratioMissText")) $("ratioMissText").textContent = `${cacheMisses} (${missRatio.toFixed(1)}%)`;
        }
    }

    // 3C Miss taxonomy counters
    if ($("compulsoryCount")) $("compulsoryCount").textContent = compulsoryMisses;
    if ($("conflictCount")) $("conflictCount").textContent = conflictMisses;
    if ($("capacityCount")) $("capacityCount").textContent = capacityMisses;

    // AMAT Breakdown equation display
    if ($("amatBreakdown")) {
        $("amatBreakdown").innerHTML = `${hitTime}.0 + (${(total > 0 ? cacheMisses / total : 0).toFixed(2)} × ${missPenalty}.0) = <strong>${amat.toFixed(2)} cycles</strong>`;
    }

    const config = getConfig();

    // Mapping Labels & Summary
    let mappingName = "Direct Mapping";
    if (config.mapping === "associative") {
        mappingName = "Fully Associative";
    } else if (config.mapping === "set") {
        mappingName = `${config.ways}-Way Set Associative`;
    }

    if ($("mappingLabel")) $("mappingLabel").textContent = mappingName;
    if ($("configSummaryBadge")) {
        $("configSummaryBadge").textContent = `${config.lines} Lines • ${config.blockSize} Word/Block • ${mappingName}`;
    }
    if ($("cacheCapacityLabel")) {
        $("cacheCapacityLabel").textContent = `${config.lines * config.blockSize} Words Total Capacity`;
    }

    renderCacheTable(config);
}

// 13. CACHE MEMORY TABLE RENDERER WITH SET GROUPING & ACTIVE HIGHLIGHT
function renderCacheTable(config) {
    const table = $("cacheTable");
    if (!table) return;
    table.innerHTML = "";

    let currentSet = -1;

    cache.forEach((line, index) => {
        let setNumber = "-";
        if (config.mapping === "set") {
            setNumber = Math.floor(index / config.ways);

            // Add set header row when transitioning sets
            if (setNumber !== currentSet) {
                currentSet = setNumber;
                const setHeader = document.createElement("tr");
                setHeader.className = "set-header-row";
                setHeader.innerHTML = `<td colspan="8">📦 SET ${setNumber} (Lines ${setNumber * config.ways} – ${(setNumber + 1) * config.ways - 1})</td>`;
                table.appendChild(setHeader);
            }
        }

        const row = document.createElement("tr");

        // Row highlighting logic
        if (index === lastAccessedLine) {
            row.className = lastResultType === "hit" ? "row-hit" : "row-miss";
        } else if (lastCandidates.includes(index) && config.mapping === "set") {
            row.className = "row-candidate";
        }

        // Stored words display
        let storedWords = "—";
        if (line.valid && line.block !== null) {
            const startWord = line.block * config.blockSize;
            const endWord = startWord + config.blockSize - 1;
            storedWords = config.blockSize === 1 ? `Word ${startWord}` : `Words ${startWord}–${endWord}`;
        }

        // Policy metadata
        let metadata = "—";
        if (line.valid) {
            metadata = `Age: t=${line.inserted} | Last: t=${line.lastUsed}`;
            if (config.policy === "LFU") {
                metadata += ` | Freq: ${line.accessCount}`;
            }
        }

        // Status badge
        let statusBadge = `<span class="pill-invalid">EMPTY</span>`;
        if (line.valid) {
            if (index === lastAccessedLine) {
                statusBadge = lastResultType === "hit"
                    ? `<span class="pill-valid">HIT ACCESSED</span>`
                    : `<span class="pill-valid" style="background:var(--amber-bg);color:var(--amber-light);">ALLOCATED</span>`;
            } else {
                statusBadge = `<span class="pill-valid">VALID</span>`;
            }
        }

        row.innerHTML = `
            <td><strong>Line ${index}</strong></td>
            <td>${setNumber}</td>
            <td>${line.valid ? `<span class="pill-valid">1</span>` : `<span class="pill-invalid">0</span>`}</td>
            <td class="tag-mono">${line.valid ? line.tag : "—"}</td>
            <td><strong>${line.valid ? `Block ${line.block}` : "—"}</strong></td>
            <td>${storedWords}</td>
            <td><small class="muted">${metadata}</small></td>
            <td>${statusBadge}</td>
        `;

        table.appendChild(row);
    });
}

// 14. MEMORY ACCESS TRACE SEQUENCE CONTROLLER
function loadSequence() {
    const raw = $("sequence").value.trim();

    if (!raw) {
        if ($("sequenceStatus")) {
            $("sequenceStatus").textContent = "Please enter comma-separated addresses or select an academic preset.";
        }
        return;
    }

    const tokens = raw.split(/[\s,]+/).filter(Boolean);
    const parsedSequence = [];

    for (let token of tokens) {
        let val;
        if (token.startsWith("0x") || token.startsWith("0X")) {
            if (!/^0x[0-9a-fA-F]+$/i.test(token)) {
                if ($("sequenceStatus")) {
                    $("sequenceStatus").textContent = `Invalid hex address "${token}". Use valid hex digits (e.g. 0x0C).`;
                }
                return;
            }
            val = parseInt(token, 16);
        } else {
            if (!/^\d+$/.test(token)) {
                if ($("sequenceStatus")) {
                    $("sequenceStatus").textContent = `Invalid decimal address "${token}". Numbers must be non-negative integers.`;
                }
                return;
            }
            val = Number(token);
        }

        if (!Number.isSafeInteger(val) || val < 0) {
            if ($("sequenceStatus")) {
                $("sequenceStatus").textContent = `Invalid address "${token}". Please enter valid non-negative integers or hex numbers.`;
            }
            return;
        }
        parsedSequence.push(val);
    }

    if (parsedSequence.length === 0) {
        if ($("sequenceStatus")) {
            $("sequenceStatus").textContent = "No valid addresses found in sequence.";
        }
        return;
    }

    resetSimulation();
    sequence = parsedSequence;
    sequenceIndex = 0;

    if ($("sequenceStatus")) {
        $("sequenceStatus").textContent = `Loaded ${sequence.length} addresses: [${sequence.slice(0, 10).join(", ")}${sequence.length > 10 ? "..." : ""}]. Click "Step Next →" or "▶ Auto Play" to begin.`;
    }
}

function nextSequenceStep() {
    if (sequence.length === 0) {
        loadSequence();
        if (sequence.length === 0) return false;
    }

    if (sequenceIndex >= sequence.length) {
        if ($("sequenceStatus")) {
            $("sequenceStatus").textContent = `Sequence execution completed! Processed all ${sequence.length} memory requests.`;
        }
        stopAutoPlay();
        return false;
    }

    const addr = sequence[sequenceIndex];
    $("address").value = addr;
    accessMemory(addr);
    sequenceIndex++;

    if ($("sequenceStatus")) {
        $("sequenceStatus").textContent = `Step ${sequenceIndex} of ${sequence.length} (Processed Address: ${addr}). ${sequence.length - sequenceIndex} remaining.`;
    }

    return true;
}

function toggleAutoPlay() {
    if (autoPlayTimer) {
        stopAutoPlay();
    } else {
        startAutoPlay();
    }
}

function startAutoPlay() {
    if (sequence.length === 0) {
        loadSequence();
        if (sequence.length === 0) return;
    }

    if (sequenceIndex >= sequence.length) {
        sequenceIndex = 0;
        resetSimulation();
        loadSequence();
    }

    const speedSelect = $("playSpeed");
    const intervalMs = speedSelect ? Number(speedSelect.value) : 900;

    const autoBtn = $("autoPlayBtn");
    if (autoBtn) {
        autoBtn.textContent = "⏸ Pause Auto";
        if (autoBtn.classList) autoBtn.classList.add("btn-danger");
    }

    autoPlayTimer = setInterval(() => {
        const hasNext = nextSequenceStep();
        if (!hasNext) {
            stopAutoPlay();
        }
    }, intervalMs);
}

function stopAutoPlay() {
    if (autoPlayTimer) {
        clearInterval(autoPlayTimer);
        autoPlayTimer = null;
    }
    const autoBtn = $("autoPlayBtn");
    if (autoBtn) {
        autoBtn.textContent = "▶ Auto Play";
        if (autoBtn.classList) autoBtn.classList.remove("btn-danger");
    }
}

// 15. SIMULATION ACCESS AUDIT HISTORY
function renderHistory() {
    const existing = $("historyTable");
    if (!existing) return;
    existing.innerHTML = "";

    history.forEach(item => {
        const row = document.createElement("tr");
        const isHit = item.result === "HIT";

        row.innerHTML = `
            <td>#${item.access}</td>
            <td><strong>${item.address}</strong> <small class="muted">(${item.hex})</small></td>
            <td>Block ${item.block}</td>
            <td>${item.offset}</td>
            <td>${item.set !== "-" ? `Set ${item.set} / ` : ""}Line ${item.line}</td>
            <td><span class="${isHit ? "pill-valid" : "pill-invalid"}">${item.result}</span></td>
            <td><small>${item.missType}</small></td>
            <td>${item.policy}</td>
            <td>${item.replacedBlock !== "—" ? `Block ${item.replacedBlock}` : "—"}</td>
        `;

        existing.appendChild(row);
    });
}

function clearHistory() {
    history = [];
    renderHistory();
}

function exportHistoryCSV() {
    if (history.length === 0) {
        showMessage("No simulation history available to export. Access memory first.", "miss");
        return;
    }

    const headers = ["Access_No", "Decimal_Address", "Hex_Address", "Memory_Block", "Word_Offset", "Cache_Line", "Set_No", "Tag", "Result", "Miss_Classification", "Replacement_Policy", "Replaced_Block"];
    const rows = history.map(item => [
        item.access,
        item.address,
        item.hex,
        item.block,
        item.offset,
        item.line,
        item.set,
        item.tag,
        item.result,
        item.missType,
        item.policy,
        item.replacedBlock
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const filename = `cachelab_simulation_trace_${Date.now()}.csv`;

    try {
        if (typeof Blob !== "undefined" && typeof URL !== "undefined" && URL.createObjectURL) {
            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", filename);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 100);
            return;
        }
    } catch (e) {
        // Fallback below
    }

    const encodedUri = encodeURI("data:text/csv;charset=utf-8," + csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 16. MULTI-MAPPING SCHEME BENCHMARK COMPARATOR
function runMappingComparison() {
    let testSequence = (sequence && sequence.length > 0) ? sequence : [];
    if (testSequence.length === 0) {
        const raw = $("sequence").value.trim();
        if (raw) {
            testSequence = raw.split(/[\s,]+/).filter(Boolean).map(v => v.startsWith("0x") ? parseInt(v, 16) : Number(v)).filter(n => Number.isSafeInteger(n) && n >= 0);
        }
    }

    if (testSequence.length === 0 && history.length > 0) {
        testSequence = history.slice().reverse().map(h => h.address);
        $("sequence").value = testSequence.join(", ");
    }

    if (testSequence.length === 0) {
        // Fallback standard benchmark sequence
        testSequence = [0, 4, 8, 0, 12, 16, 4, 8, 0, 4, 8, 12];
        $("sequence").value = testSequence.join(", ");
    }

    const currentConfig = getConfig();
    const lines = currentConfig.lines;
    const blockSize = currentConfig.blockSize;
    const policy = currentConfig.policy;
    const { hitTime, missPenalty } = getLatencyProfile();

    const schemes = [
        { name: "Direct Mapping", mapping: "direct", ways: 1 }
    ];

    if (lines >= 4) {
        schemes.push({ name: "2-Way Set-Associative", mapping: "set", ways: 2 });
    }
    if (lines >= 8) {
        schemes.push({ name: "4-Way Set-Associative", mapping: "set", ways: 4 });
    }
    if (lines >= 16) {
        schemes.push({ name: "8-Way Set-Associative", mapping: "set", ways: 8 });
    }
    schemes.push({ name: "Fully Associative", mapping: "associative", ways: lines });

    function simulateScheme(scheme) {
        let simCache = Array.from({ length: lines }, () => ({ valid: false, block: null, inserted: 0, lastUsed: 0, accessCount: 0 }));
        let simHits = 0;
        let simMisses = 0;
        let simConflict = 0;
        let simAccessed = new Set();
        let simClock = 0;

        testSequence.forEach(addr => {
            simClock++;
            const blk = Math.floor(addr / blockSize);
            let candidates = [];

            if (scheme.mapping === "direct") {
                candidates = [blk % lines];
            } else if (scheme.mapping === "associative") {
                candidates = simCache.map((_, i) => i);
            } else {
                const totalSets = lines / scheme.ways;
                const setNum = blk % totalSets;
                candidates = Array.from({ length: scheme.ways }, (_, i) => setNum * scheme.ways + i);
            }

            const found = candidates.find(i => simCache[i].valid && simCache[i].block === blk);
            if (found !== undefined) {
                simHits++;
                simCache[found].lastUsed = simClock;
                simCache[found].accessCount = (simCache[found].accessCount || 0) + 1;
            } else {
                simMisses++;
                if (simAccessed.has(blk) && !simCache.every(c => c.valid)) {
                    simConflict++;
                }
                simAccessed.add(blk);

                let victim = candidates.find(i => !simCache[i].valid);
                if (victim === undefined) {
                    if (policy === "FIFO") {
                        victim = candidates.reduce((oldest, c) => simCache[c].inserted < simCache[oldest].inserted ? c : oldest);
                    } else if (policy === "LRU") {
                        victim = candidates.reduce((leastUsed, c) => simCache[c].lastUsed < simCache[leastUsed].lastUsed ? c : leastUsed);
                    } else if (policy === "LFU") {
                        victim = candidates.reduce((minFreq, c) => {
                            if ((simCache[c].accessCount || 0) < (simCache[minFreq].accessCount || 0)) return c;
                            if ((simCache[c].accessCount || 0) === (simCache[minFreq].accessCount || 0)) {
                                return simCache[c].inserted < simCache[minFreq].inserted ? c : minFreq;
                            }
                            return minFreq;
                        });
                    }
                }
                simCache[victim] = { valid: true, block: blk, inserted: simClock, lastUsed: simClock, accessCount: 1 };
            }
        });

        const hitRatio = (simHits / testSequence.length) * 100;
        const amat = hitTime + ((simMisses / testSequence.length) * missPenalty);

        return {
            name: scheme.name,
            ways: scheme.mapping === "direct" ? "1-Way (Direct)" : scheme.mapping === "associative" ? `${lines}-Way (Full)` : `${scheme.ways}-Way`,
            sets: scheme.mapping === "direct" ? lines : scheme.mapping === "associative" ? 1 : lines / scheme.ways,
            hits: simHits,
            misses: simMisses,
            hitRatio: hitRatio.toFixed(1) + "%",
            hitRatioVal: hitRatio,
            conflict: simConflict,
            amat: amat.toFixed(2)
        };
    }

    const results = schemes.map(simulateScheme);
    const tbody = $("comparisonTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    results.forEach(res => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong>${res.name}</strong></td>
            <td>${res.ways}</td>
            <td>${res.sets}</td>
            <td class="green"><strong>${res.hits}</strong></td>
            <td class="red"><strong>${res.misses}</strong></td>
            <td><strong>${res.hitRatio}</strong></td>
            <td>${res.conflict}</td>
            <td>${res.amat} cycles</td>
            <td>
                <div class="comparison-bar-bg" title="Hit Ratio: ${res.hitRatio}">
                    <div class="comparison-bar-fill" style="width: ${res.hitRatioVal}%;"></div>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });

    const container = $("comparisonContainer");
    if (container) {
        container.style.display = "block";
        container.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
}

// 17. EDUCATIONAL PRESET HANDLERS
function applyPreset(presetKey) {
    stopAutoPlay();

    switch (presetKey) {
        case "spatial":
            $("blockSize").value = "4";
            $("cacheSize").value = "8";
            $("mapping").value = "direct";
            $("waysControl").hidden = true;
            $("policy").value = "LRU";
            $("sequence").value = "0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11";
            loadSequence();
            showMessage("Loaded Spatial Locality Preset: Block Size = 4 words. Sequential accesses (0–3, 4–7) exploit multi-word blocks, yielding a 75% hit rate!", "hit");
            break;

        case "temporal":
            $("blockSize").value = "1";
            $("cacheSize").value = "8";
            $("mapping").value = "direct";
            $("waysControl").hidden = true;
            $("policy").value = "LRU";
            $("sequence").value = "4, 12, 4, 16, 4, 12, 4, 16, 4, 12";
            loadSequence();
            showMessage("Loaded Temporal Locality Preset: Frequently re-referenced addresses (4, 12, 16) remain resident in cache lines, minimizing misses.", "hit");
            break;

        case "conflict":
            $("blockSize").value = "1";
            $("cacheSize").value = "8";
            $("mapping").value = "direct";
            $("waysControl").hidden = true;
            $("policy").value = "LRU";
            $("sequence").value = "0, 8, 0, 8, 0, 8, 0, 8";
            loadSequence();
            showMessage("Loaded Direct-Mapped Conflict Thrashing Preset: Addresses 0 and 8 both map to Line 0 (0 % 8 = 0, 8 % 8 = 0), repeatedly evicting each other!", "miss");
            break;

        case "setresolve":
            $("blockSize").value = "1";
            $("cacheSize").value = "8";
            $("mapping").value = "set";
            $("waysControl").hidden = false;
            updateWaysOptions();
            $("ways").value = "2";
            $("policy").value = "LRU";
            $("sequence").value = "0, 8, 0, 8, 0, 8, 0, 8";
            loadSequence();
            showMessage("Loaded Set-Associative Conflict Resolution: 2-Way set-associativity provides 2 lines per set. Addresses 0 and 8 can now co-exist in Set 0 without thrashing!", "hit");
            break;

        case "policytest":
            $("blockSize").value = "1";
            $("cacheSize").value = "4";
            $("mapping").value = "associative";
            $("waysControl").hidden = true;
            $("policy").value = "LRU";
            $("sequence").value = "0, 4, 8, 12, 0, 16, 4";
            loadSequence();
            showMessage("Loaded Eviction Policy Comparison Preset: A 4-line cache evaluates which block is victimized when Address 16 enters. Switch between LRU and FIFO to see differing decisions!", "hit");
            break;
    }
}

// 18. APPLICATION INITIALIZATION & EVENT BINDINGS
function initializeApplication() {
    try {
        updateWaysOptions();

        const waysCtrl = $("waysControl");
        if (waysCtrl) {
            waysCtrl.hidden = $("mapping").value !== "set";
        }

        initializeCache();
        updateDashboard();

        const seqStatus = $("sequenceStatus");
        if (seqStatus) seqStatus.textContent = "No sequence loaded. Enter addresses or choose a preset above.";

        const result = $("result");
        if (result) result.textContent = "Welcome to CacheLab! Enter a memory address or trace sequence to start simulation.";

    } catch (error) {
        showMessage(error.message, "miss");
    }
}

// Event Listeners
$("accessBtn").addEventListener("click", () => {
    const val = $("address").value.trim();
    if (val === "") {
        showMessage("Please enter a memory address to access.", "miss");
        return;
    }
    accessMemory(val);
});

$("address").addEventListener("keydown", event => {
    if (event.key === "Enter") {
        $("accessBtn").click();
    }
});

const seqInput = $("sequence");
if (seqInput) {
    seqInput.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            $("loadBtn").click();
        }
    });
}

const randomBtn = $("randomBtn");
if (randomBtn) {
    randomBtn.addEventListener("click", () => {
        const randAddr = Math.floor(Math.random() * 64);
        $("address").value = randAddr;
        accessMemory(randAddr);
    });
}

$("resetBtn").addEventListener("click", resetSimulation);
$("loadBtn").addEventListener("click", loadSequence);
$("nextBtn").addEventListener("click", nextSequenceStep);

const autoPlayBtn = $("autoPlayBtn");
if (autoPlayBtn) {
    autoPlayBtn.addEventListener("click", toggleAutoPlay);
}

const compareMappingsBtn = $("compareMappingsBtn");
if (compareMappingsBtn) {
    compareMappingsBtn.addEventListener("click", runMappingComparison);
}

const exportCsvBtn = $("exportCsvBtn");
if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", exportHistoryCSV);
}

const clearHistoryBtn = $("clearHistoryBtn");
if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener("click", clearHistory);
}

// Mapping dropdown changes
$("mapping").addEventListener("change", () => {
    const waysCtrl = $("waysControl");
    if (waysCtrl) {
        waysCtrl.hidden = $("mapping").value !== "set";
    }
    updateWaysOptions();
    resetSimulation();
});

// Cache size dropdown changes
$("cacheSize").addEventListener("change", () => {
    updateWaysOptions();
    resetSimulation();
});

// Other configuration dropdowns
["blockSize", "ways", "policy", "latencyProfile"].forEach(id => {
    const el = $(id);
    if (el) {
        el.addEventListener("change", resetSimulation);
    }
});

const playSpeedSelect = $("playSpeed");
if (playSpeedSelect) {
    playSpeedSelect.addEventListener("change", () => {
        if (autoPlayTimer) {
            stopAutoPlay();
            startAutoPlay();
        }
    });
}

// Academic Preset Buttons
document.querySelectorAll(".preset-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const presetKey = btn.getAttribute("data-preset");
        applyPreset(presetKey);
    });
});

// Start simulator on page load
initializeApplication();

/* ==========================================================================
   END OF CACHELAB ARCHITECTURAL SIMULATOR ENGINE
   ========================================================================== */
