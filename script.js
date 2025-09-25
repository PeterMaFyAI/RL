const gridElement = document.getElementById("grid");
const gridWrapper = document.getElementById("gridWrapper");
const pathOverlay = document.getElementById("pathOverlay");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const speedSlider = document.getElementById("speedSlider");
const speedLabel = document.getElementById("speedLabel");
const rowSelect = document.getElementById("rowSelect");
const colSelect = document.getElementById("colSelect");
const episodeCounter = document.getElementById("episodeCounter");
const currentScoreEl = document.getElementById("currentScore");
const bestScoreEl = document.getElementById("bestScore");
const epsilonValueEl = document.getElementById("epsilonValue");
const chartSection = document.querySelector(".chart-section");
const chartCanvas = document.getElementById("scoreChart");

let rows = 5;
let cols = 5;
const ACTIONS = ["up", "down", "left", "right"];

let startPos = { row: 0, col: 0 };
let goalPos = { row: 4, col: 4 };
let hazardPos = { row: 2, col: 2 };
let defaultWalls = [];

const OBJECT_TYPES = {
  EMPTY: "empty",
  START: "start",
  GOAL: "goal",
  HAZARD: "hazard",
  WALL: "wall",
  APPLE: "apple"
};

const OBJECT_CYCLE = [
  OBJECT_TYPES.APPLE,
  OBJECT_TYPES.WALL,
  OBJECT_TYPES.HAZARD,
  OBJECT_TYPES.GOAL,
  OBJECT_TYPES.EMPTY
];

const alpha = 0.2; // inlärningshastighet
const gamma = 0.9; // diskontering
let epsilon = 0.3; // utforskning
const minEpsilon = 0.05;
const epsilonDecay = 0.995;
const BASE_DELAY = 250;

let cells = [];
let robotPos = { ...startPos };
let qTable = [];
let currentEpisode = 0;
let currentScore = 0;
let bestScore = -Infinity;
let bestScoreEpisode = null;
let isTraining = false;
let isPaused = false;
let episodeActive = false;
let stepTimeout = null;
let episodeTimeout = null;

let cellObjects = [];

let scores = [];
let averages = [];
let currentEpisodePath = [];
let bestPath = null;

const appleCells = new Set();

function positionKey(row, col) {
  return `${row},${col}`;
}

function positionsEqual(a, b) {
  return a.row === b.row && a.col === b.col;
}

function clampGridSize(value) {
  const min = 2;
  const max = 8;
  if (!Number.isFinite(value)) {
    return value;
  }
  return Math.min(Math.max(value, min), max);
}

function computeHazardPosition(rowCount, colCount, start, goal) {
  const candidates = [
    { row: Math.floor(rowCount / 2), col: Math.floor(colCount / 2) },
    { row: Math.max(0, rowCount - 2), col: Math.max(0, colCount - 2) },
    { row: Math.min(rowCount - 1, 1), col: Math.max(0, colCount - 2) },
    { row: Math.max(0, rowCount - 2), col: Math.min(colCount - 1, 1) }
  ];

  return (
    candidates.find(
      candidate =>
        candidate.row >= 0 &&
        candidate.col >= 0 &&
        candidate.row < rowCount &&
        candidate.col < colCount &&
        !positionsEqual(candidate, start) &&
        !positionsEqual(candidate, goal)
    ) || { row: Math.min(rowCount - 1, 1), col: Math.min(colCount - 1, 1) }
  );
}

function computeDefaultWalls(rowCount, colCount, start, goal, hazard) {
  const usedPositions = new Set([
    positionKey(start.row, start.col),
    positionKey(goal.row, goal.col),
    positionKey(hazard.row, hazard.col)
  ]);

  const candidates = [
    {
      row: Math.floor(rowCount / 2),
      col: Math.min(colCount - 1, Math.floor(colCount / 2) + 1)
    },
    {
      row: Math.min(rowCount - 1, Math.floor(rowCount / 2) + 1),
      col: Math.floor(colCount / 2)
    },
    {
      row: Math.min(rowCount - 1, 1),
      col: Math.floor(colCount / 2)
    },
    {
      row: Math.floor(rowCount / 2),
      col: Math.min(colCount - 1, 1)
    }
  ];

  const walls = [];
  for (const candidate of candidates) {
    if (
      candidate.row < 0 ||
      candidate.col < 0 ||
      candidate.row >= rowCount ||
      candidate.col >= colCount
    ) {
      continue;
    }
    const key = positionKey(candidate.row, candidate.col);
    if (usedPositions.has(key)) {
      continue;
    }
    usedPositions.add(key);
    walls.push(candidate);
    if (walls.length === 2) {
      break;
    }
  }
  return walls;
}

function updateEnvironmentLayout() {
  startPos = { row: 0, col: 0 };
  goalPos = { row: rows - 1, col: cols - 1 };
  hazardPos = computeHazardPosition(rows, cols, startPos, goalPos);
  defaultWalls = computeDefaultWalls(rows, cols, startPos, goalPos, hazardPos);
}

function syncGridSizeSelectors() {
  if (rowSelect) {
    rowSelect.value = String(rows);
  }
  if (colSelect) {
    colSelect.value = String(cols);
  }
}

function applyGridSizeChange(newRows, newCols) {
  const clampedRows = clampGridSize(newRows);
  const clampedCols = clampGridSize(newCols);
  const targetRows = Number.isFinite(clampedRows) ? clampedRows : rows;
  const targetCols = Number.isFinite(clampedCols) ? clampedCols : cols;
  if (targetRows === rows && targetCols === cols) {
    return;
  }

  rows = targetRows;
  cols = targetCols;
  updateEnvironmentLayout();
  initializeCellObjects();
  resetTraining();
  syncGridSizeSelectors();
}

const INITIAL_Y_MIN = -15;
const INITIAL_Y_MAX = 10;
const SCALE_PADDING = 0.5;

let scoreMin = null;
let scoreMax = null;
let useDynamicScale = false;

const chart = new Chart(chartCanvas, {
  type: "line",
  data: {
    labels: [],
    datasets: [
      {
        label: "Poäng",
        data: scores,
        borderColor: "#7d8ae6",
        backgroundColor: "rgba(125, 138, 230, 0.15)",
        tension: 0.3,
        fill: true,
        pointRadius: 2
      },
      {
        label: "Genomsnitt (10 runder)",
        data: averages,
        borderColor: "#ffb7b2",
        backgroundColor: "rgba(255, 183, 178, 0.1)",
        tension: 0.2,
        fill: true,
        pointRadius: 0
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        ticks: {
          color: "rgba(47, 42, 74, 0.7)"
        },
        grid: {
          color: "rgba(125, 138, 230, 0.1)"
        }
      },
      y: {
        min: INITIAL_Y_MIN,
        max: INITIAL_Y_MAX,
        ticks: {
          color: "rgba(47, 42, 74, 0.7)"
        },
        grid: {
          color: "rgba(125, 138, 230, 0.1)"
        }
      }
    },
    plugins: {
      legend: {
        labels: {
          color: "rgba(47, 42, 74, 0.7)"
        }
      }
    }
  }
});

function updateChartScale() {
  const yScale = chart.options.scales.y;

  if (!useDynamicScale) {
    yScale.min = INITIAL_Y_MIN;
    yScale.max = INITIAL_Y_MAX;
    return;
  }

  if (scoreMin === null || scoreMax === null) {
    yScale.min = INITIAL_Y_MIN;
    yScale.max = INITIAL_Y_MAX;
    return;
  }

  let lowerBound = Math.min(scoreMin - SCALE_PADDING, INITIAL_Y_MIN);
  let upperBound = Math.max(scoreMax + SCALE_PADDING, INITIAL_Y_MAX);

  if (lowerBound >= upperBound) {
    const center = (lowerBound + upperBound) / 2;
    const offset = 1;
    yScale.min = center - offset;
    yScale.max = center + offset;
    return;
  }

  yScale.min = lowerBound;
  yScale.max = upperBound;
}

function recalculateScoreExtrema() {
  if (!scores.length) {
    scoreMin = null;
    scoreMax = null;
    return;
  }

  scoreMin = scores.reduce((min, value) => Math.min(min, value), scores[0]);
  scoreMax = scores.reduce((max, value) => Math.max(max, value), scores[0]);
}

function createGrid() {
  gridElement.innerHTML = "";
  cells = [];
  gridElement.style.setProperty("--grid-cols", cols);
  gridElement.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;
  for (let r = 0; r < rows; r++) {
    const rowCells = [];
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = r;
      cell.dataset.col = c;
      if (r === startPos.row && c === startPos.col) {
        cell.classList.add("start-cell");
      } else {
        cell.addEventListener("click", handleCellClick);
      }
      const span = document.createElement("span");
      span.className = "object-icon";
      cell.appendChild(span);
      gridElement.appendChild(cell);
      rowCells.push(cell);
    }
    cells.push(rowCells);
  }
  updateAllCellVisuals();
  updateRobotVisual();
  updateOverlaySize();
  if (!isPaused) {
    clearPathOverlay();
  }
}

function handleCellClick(event) {
  const cell = event.currentTarget;
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);

  const currentType = cellObjects[row][col];
  const cycleIndex = OBJECT_CYCLE.indexOf(currentType);
  const nextType =
    cycleIndex === -1
      ? OBJECT_CYCLE[0]
      : OBJECT_CYCLE[(cycleIndex + 1) % OBJECT_CYCLE.length];

  setCellObject(row, col, nextType);
  if (!hasAnyTerminalCell()) {
    setCellObject(row, col, OBJECT_TYPES.GOAL);
  }
  updateRobotVisual();
  bestPath = null;
  if (isPaused) {
    renderBestPath();
  } else {
    clearPathOverlay();
  }
}

function createEmptyObjectGrid() {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => OBJECT_TYPES.EMPTY)
  );
}

function initializeCellObjects() {
  cellObjects = createEmptyObjectGrid();
  appleCells.clear();
  cellObjects[startPos.row][startPos.col] = OBJECT_TYPES.START;
  cellObjects[goalPos.row][goalPos.col] = OBJECT_TYPES.GOAL;
  cellObjects[hazardPos.row][hazardPos.col] = OBJECT_TYPES.HAZARD;
  defaultWalls.forEach(wall => {
    cellObjects[wall.row][wall.col] = OBJECT_TYPES.WALL;
  });
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cellObjects[r][c] === OBJECT_TYPES.APPLE) {
        appleCells.add(positionKey(r, c));
      }
    }
  }
}

function setCellObject(row, col, type, options = {}) {
  if (row === startPos.row && col === startPos.col) {
    return;
  }
  const { trackApple = true } = options;
  cellObjects[row][col] = type;
  if (trackApple) {
    const key = positionKey(row, col);
    if (type === OBJECT_TYPES.APPLE) {
      appleCells.add(key);
    } else {
      appleCells.delete(key);
    }
  }
  renderCell(row, col);
}

function getCellObject(row, col) {
  return cellObjects[row]?.[col] ?? OBJECT_TYPES.EMPTY;
}

function restoreApplesForNewEpisode() {
  appleCells.forEach(key => {
    const [rowStr, colStr] = key.split(",");
    const row = Number(rowStr);
    const col = Number(colStr);
    if (row === startPos.row && col === startPos.col) {
      return;
    }
    if (!Number.isInteger(row) || !Number.isInteger(col)) {
      return;
    }
    if (!cellObjects[row] || typeof cellObjects[row][col] === "undefined") {
      return;
    }
    if (cellObjects[row][col] !== OBJECT_TYPES.APPLE) {
      cellObjects[row][col] = OBJECT_TYPES.APPLE;
      renderCell(row, col);
    }
  });
}

function consumeApple(row, col) {
  setCellObject(row, col, OBJECT_TYPES.EMPTY, { trackApple: false });
}

function getObjectIcon(type) {
  switch (type) {
    case OBJECT_TYPES.START:
      return "🏠";
    case OBJECT_TYPES.GOAL:
      return "💎";
    case OBJECT_TYPES.HAZARD:
      return "💀";
    case OBJECT_TYPES.WALL:
      return "🚧";
    case OBJECT_TYPES.APPLE:
      return "🍎";
    default:
      return "";
  }
}

function renderCell(row, col) {
  const cell = cells[row]?.[col];
  if (!cell) return;
  const span = cell.querySelector(".object-icon");
  if (!span) return;
  const type = cellObjects[row][col];
  span.textContent = getObjectIcon(type);
}

function updateAllCellVisuals() {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      renderCell(r, c);
    }
  }
}

function hasAnyTerminalCell() {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const type = cellObjects[r][c];
      if (type === OBJECT_TYPES.GOAL || type === OBJECT_TYPES.HAZARD) {
        return true;
      }
    }
  }
  return false;
}

function initQTable() {
  qTable = Array.from({ length: rows * cols }, () =>
    ACTIONS.map(() => 0)
  );
}

function stateIndex(row, col) {
  return row * cols + col;
}

function getSpeedDelay() {
  const multiplier = Number(speedSlider.value);
  return BASE_DELAY / multiplier;
}

function updateSpeedLabel() {
  const multiplier = Number(speedSlider.value);
  speedLabel.textContent = multiplier === 1 ? "Bas" : `${multiplier}×`;
}

function syncChartHeight() {
  if (!chartSection) return;
  const gridHeight = gridElement.offsetHeight;
  chartSection.style.minHeight = `${gridHeight}px`;
  chartSection.style.height = `${gridHeight}px`;
  chartCanvas.style.height = `${gridHeight}px`;
  chartCanvas.height = gridHeight;
  chart.resize();
}

function updateOverlaySize() {
  if (!pathOverlay || !gridElement) return;
  const width = gridElement.offsetWidth;
  const height = gridElement.offsetHeight;
  pathOverlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
  pathOverlay.setAttribute("width", width);
  pathOverlay.setAttribute("height", height);
}

function clearPathOverlay() {
  if (!pathOverlay) return;
  pathOverlay.innerHTML = "";
  pathOverlay.classList.remove("visible");
}

function renderBestPath() {
  if (!pathOverlay || !gridWrapper) return;
  if (!bestPath || bestPath.length < 2) {
    clearPathOverlay();
    return;
  }

  updateOverlaySize();
  const wrapperRect = gridWrapper.getBoundingClientRect();

  const points = bestPath
    .map(position => {
      const cell = cells[position.row]?.[position.col];
      if (!cell) return null;
      const rect = cell.getBoundingClientRect();
      const x = rect.left - wrapperRect.left + rect.width / 2;
      const y = rect.top - wrapperRect.top + rect.height / 2;
      return `${x},${y}`;
    })
    .filter(Boolean);

  if (points.length < 2) {
    clearPathOverlay();
    return;
  }

  pathOverlay.innerHTML = `<polyline points="${points.join(" ")}"></polyline>`;
  pathOverlay.classList.add("visible");
}

function updateRobotVisual() {
  cells.flat().forEach(cell => cell.classList.remove("robot-active"));
  gridElement.querySelectorAll(".robot-icon").forEach(icon => icon.remove());
  const { row, col } = robotPos;
  const cell = cells[row]?.[col];
  if (!cell) return;
  cell.classList.add("robot-active");
  const robotSpan = document.createElement("span");
  robotSpan.className = "robot-icon";
  robotSpan.textContent = "🤖";
  cell.appendChild(robotSpan);
}

function isWall(row, col) {
  return getCellObject(row, col) === OBJECT_TYPES.WALL;
}

function takeStep(action) {
  let { row, col } = robotPos;
  let nextRow = row;
  let nextCol = col;

  if (action === "up") nextRow--;
  if (action === "down") nextRow++;
  if (action === "left") nextCol--;
  if (action === "right") nextCol++;

  if (
    nextRow < 0 ||
    nextRow >= rows ||
    nextCol < 0 ||
    nextCol >= cols ||
    isWall(nextRow, nextCol)
  ) {
    nextRow = row;
    nextCol = col;
  }

  let reward = -0.1;
  let done = false;

  const targetObject = getCellObject(nextRow, nextCol);

  if (targetObject === OBJECT_TYPES.GOAL) {
    reward += 10;
    done = true;
  } else if (targetObject === OBJECT_TYPES.HAZARD) {
    reward -= 10;
    done = true;
  } else if (targetObject === OBJECT_TYPES.APPLE) {
    reward += 3;
    consumeApple(nextRow, nextCol);
  }

  robotPos = { row: nextRow, col: nextCol };
  updateRobotVisual();
  currentEpisodePath.push({ ...robotPos });

  return { reward, done };
}

function chooseAction(stateIdx) {
  if (Math.random() < epsilon) {
    return Math.floor(Math.random() * ACTIONS.length);
  }
  const values = qTable[stateIdx];
  const maxValue = Math.max(...values);
  const bestActions = values
    .map((value, index) => ({ value, index }))
    .filter(item => item.value === maxValue)
    .map(item => item.index);
  return bestActions[Math.floor(Math.random() * bestActions.length)];
}

function updateQTable(stateIdx, actionIdx, reward, nextStateIdx) {
  const currentQ = qTable[stateIdx][actionIdx];
  const maxNextQ = Math.max(...qTable[nextStateIdx]);
  const newQ =
    currentQ + alpha * (reward + gamma * maxNextQ - currentQ);
  qTable[stateIdx][actionIdx] = newQ;
}

function stepLoop() {
  if (!isTraining || isPaused || !episodeActive) return;

  const stateIdx = stateIndex(robotPos.row, robotPos.col);
  const actionIdx = chooseAction(stateIdx);
  const action = ACTIONS[actionIdx];
  const { reward, done } = takeStep(action);

  const nextStateIdx = stateIndex(robotPos.row, robotPos.col);
  updateQTable(stateIdx, actionIdx, reward, nextStateIdx);

  currentScore += reward;
  currentScoreEl.textContent = currentScore.toFixed(1);

  if (done) {
    episodeActive = false;
    finalizeEpisode(currentScore);
    episodeTimeout = setTimeout(() => {
      if (!isTraining || isPaused) return;
      runEpisode();
    }, 400);
    return;
  }

  scheduleStepLoop();
}

function scheduleStepLoop(delay = getSpeedDelay()) {
  clearTimeout(stepTimeout);
  stepTimeout = setTimeout(stepLoop, delay);
}

function runEpisode() {
  if (!isTraining || isPaused) return;
  restoreApplesForNewEpisode();
  episodeActive = true;
  currentEpisode += 1;
  episodeCounter.textContent = currentEpisode;
  currentScore = 0;
  currentScoreEl.textContent = currentScore.toFixed(1);
  robotPos = { ...startPos };
  currentEpisodePath = [{ ...startPos }];
  updateRobotVisual();
  scheduleStepLoop(getSpeedDelay());
}

function finalizeEpisode(score) {
  epsilon = Math.max(minEpsilon, epsilon * epsilonDecay);
  updateEpsilonDisplay();
  scores.push(Number(score.toFixed(2)));
  if (scores.length > 200) {
    scores.shift();
    chart.data.labels.shift();
    averages.shift();
  }
  chart.data.labels.push(`Ep ${currentEpisode}`);

  const startIdx = Math.max(0, scores.length - 10);
  const slice = scores.slice(startIdx);
  const avg = slice.reduce((acc, val) => acc + val, 0) / slice.length;
  averages.push(Number(avg.toFixed(2)));

  recalculateScoreExtrema();
  const hasExtrema = scoreMin !== null && scoreMax !== null;
  const isOutsideInitialRange =
    hasExtrema &&
    (scoreMin < INITIAL_Y_MIN || scoreMax > INITIAL_Y_MAX);

  if (isOutsideInitialRange) {
    useDynamicScale = true;
  } else if (
    useDynamicScale &&
    hasExtrema &&
    scoreMin >= INITIAL_Y_MIN &&
    scoreMax <= INITIAL_Y_MAX
  ) {
    useDynamicScale = false;
  }
  updateChartScale();

  chart.update();

  if (score > bestScore) {
    bestScore = score;
    bestScoreEpisode = currentEpisode;
    updateBestScoreDisplay();
    bestPath = currentEpisodePath.map(position => ({ ...position }));
    if (isPaused) {
      renderBestPath();
    }
  }
}

function startTraining() {
  if (isTraining && isPaused) {
    isPaused = false;
    pauseBtn.textContent = "Pausa";
    clearPathOverlay();
    if (episodeActive) {
      scheduleStepLoop(getSpeedDelay());
    } else {
      runEpisode();
    }
    return;
  }
  if (isTraining) return;
  isTraining = true;
  isPaused = false;
  pauseBtn.textContent = "Pausa";
  if (!episodeActive) {
    runEpisode();
  }
}

function pauseTraining() {
  if (!isTraining) return;
  isPaused = true;
  pauseBtn.textContent = "Fortsätt";
  clearTimeout(stepTimeout);
  clearTimeout(episodeTimeout);
  renderBestPath();
}

function resetTraining() {
  isTraining = false;
  isPaused = false;
  episodeActive = false;
  pauseBtn.textContent = "Pausa";
  clearTimeout(stepTimeout);
  clearTimeout(episodeTimeout);
  epsilon = 0.3;
  updateEpsilonDisplay();
  currentEpisode = 0;
  currentScore = 0;
  bestScore = -Infinity;
  bestScoreEpisode = null;
  bestPath = null;
  currentEpisodePath = [];
  scores = [];
  averages = [];
  chart.data.labels = [];
  chart.data.datasets[0].data = scores;
  chart.data.datasets[1].data = averages;
  scoreMin = null;
  scoreMax = null;
  useDynamicScale = false;
  updateChartScale();
  chart.update();
  episodeCounter.textContent = "0";
  currentScoreEl.textContent = "0";
  updateBestScoreDisplay();
  robotPos = { ...startPos };
  initQTable();
  restoreApplesForNewEpisode();
  createGrid();
  syncChartHeight();
  clearPathOverlay();
}

startBtn.addEventListener("click", startTraining);
pauseBtn.addEventListener("click", () => {
  if (!isTraining) return;
  if (isPaused) {
    startTraining();
    return;
  }
  pauseTraining();
});
resetBtn.addEventListener("click", resetTraining);

speedSlider.addEventListener("input", () => {
  updateSpeedLabel();
  if (isTraining && !isPaused && episodeActive) {
    scheduleStepLoop(getSpeedDelay());
  }
});

if (rowSelect) {
  rowSelect.addEventListener("change", () => {
    const rawRows = Number(rowSelect.value);
    const newRows = Number.isFinite(rawRows) ? rawRows : rows;
    const rawCols = colSelect ? Number(colSelect.value) : cols;
    const newCols = Number.isFinite(rawCols) ? rawCols : cols;
    applyGridSizeChange(newRows, newCols);
  });
}

if (colSelect) {
  colSelect.addEventListener("change", () => {
    const rawRows = rowSelect ? Number(rowSelect.value) : rows;
    const newRows = Number.isFinite(rawRows) ? rawRows : rows;
    const rawCols = Number(colSelect.value);
    const newCols = Number.isFinite(rawCols) ? rawCols : cols;
    applyGridSizeChange(newRows, newCols);
  });
}

updateEnvironmentLayout();
syncGridSizeSelectors();
initializeCellObjects();
createGrid();
initQTable();
updateSpeedLabel();
syncChartHeight();
updateEpsilonDisplay();
updateBestScoreDisplay();
window.addEventListener("resize", () => {
  syncChartHeight();
  if (isPaused) {
    renderBestPath();
  } else {
    updateOverlaySize();
  }
});

function updateEpsilonDisplay() {
  if (!epsilonValueEl) return;
  epsilonValueEl.textContent = epsilon.toFixed(2);
}

function updateBestScoreDisplay() {
  if (!bestScoreEl) return;
  const hasBestScore = bestScore !== -Infinity;
  const scoreText = hasBestScore ? bestScore.toFixed(1) : "0";
  const episodeText = hasBestScore && bestScoreEpisode !== null ? bestScoreEpisode : "–";
  bestScoreEl.innerHTML = `<span class="best-score-value">${scoreText}</span><span class="best-score-episode">(Ep ${episodeText})</span>`;
}
