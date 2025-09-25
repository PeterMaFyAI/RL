const gridElement = document.getElementById("grid");
const gridWrapper = document.getElementById("gridWrapper");
const pathOverlay = document.getElementById("pathOverlay");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const speedSlider = document.getElementById("speedSlider");
const speedLabel = document.getElementById("speedLabel");
const episodeCounter = document.getElementById("episodeCounter");
const currentScoreEl = document.getElementById("currentScore");
const bestScoreEl = document.getElementById("bestScore");
const epsilonValueEl = document.getElementById("epsilonValue");
const chartSection = document.querySelector(".chart-section");
const chartCanvas = document.getElementById("scoreChart");

const ROWS = 5;
const COLS = 5;
const ACTIONS = ["up", "down", "left", "right"];

const startPos = { row: 0, col: 0 };
const goalPos = { row: 4, col: 4 };
const hazardPos = { row: 2, col: 2 };
const walls = [
  { row: 1, col: 3 },
  { row: 3, col: 1 }
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
let isTraining = false;
let isPaused = false;
let episodeActive = false;
let stepTimeout = null;
let episodeTimeout = null;

let scores = [];
let averages = [];
let currentEpisodePath = [];
let bestPath = null;

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
  for (let r = 0; r < ROWS; r++) {
    const rowCells = [];
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const span = document.createElement("span");
      if (r === startPos.row && c === startPos.col) {
        span.textContent = "🏠";
      } else if (r === goalPos.row && c === goalPos.col) {
        span.textContent = "💎";
      } else if (r === hazardPos.row && c === hazardPos.col) {
        span.textContent = "💀";
      } else if (isWall(r, c)) {
        span.textContent = "🚧";
      }
      cell.appendChild(span);
      gridElement.appendChild(cell);
      rowCells.push(cell);
    }
    cells.push(rowCells);
  }
  updateRobotVisual();
  updateOverlaySize();
  if (!isPaused) {
    clearPathOverlay();
  }
}

function initQTable() {
  qTable = Array.from({ length: ROWS * COLS }, () =>
    ACTIONS.map(() => 0)
  );
}

function stateIndex(row, col) {
  return row * COLS + col;
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
  const cell = cells[row][col];
  cell.classList.add("robot-active");
  const robotSpan = document.createElement("span");
  robotSpan.className = "robot-icon";
  robotSpan.textContent = "🤖";
  cell.appendChild(robotSpan);
}

function isWall(row, col) {
  return walls.some(w => w.row === row && w.col === col);
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
    nextRow >= ROWS ||
    nextCol < 0 ||
    nextCol >= COLS ||
    isWall(nextRow, nextCol)
  ) {
    nextRow = row;
    nextCol = col;
  }

  let reward = -0.1;
  let done = false;

  if (nextRow === goalPos.row && nextCol === goalPos.col) {
    reward += 10;
    done = true;
  } else if (nextRow === hazardPos.row && nextCol === hazardPos.col) {
    reward -= 10;
    done = true;
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
    bestScoreEl.textContent = bestScore.toFixed(1);
    bestPath = currentEpisodePath.map(position => ({ ...position }));
    if (isPaused) {
      renderBestPath();
    }
  }
}

function startTraining() {
  if (isTraining && isPaused) {
    isPaused = false;
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
  if (!episodeActive) {
    runEpisode();
  }
}

function pauseTraining() {
  if (!isTraining) return;
  isPaused = true;
  clearTimeout(stepTimeout);
  clearTimeout(episodeTimeout);
  renderBestPath();
}

function resetTraining() {
  isTraining = false;
  isPaused = false;
  episodeActive = false;
  clearTimeout(stepTimeout);
  clearTimeout(episodeTimeout);
  epsilon = 0.3;
  updateEpsilonDisplay();
  currentEpisode = 0;
  currentScore = 0;
  bestScore = -Infinity;
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
  bestScoreEl.textContent = "0";
  robotPos = { ...startPos };
  initQTable();
  createGrid();
  syncChartHeight();
  clearPathOverlay();
}

startBtn.addEventListener("click", startTraining);
pauseBtn.addEventListener("click", pauseTraining);
resetBtn.addEventListener("click", resetTraining);

speedSlider.addEventListener("input", () => {
  updateSpeedLabel();
  if (isTraining && !isPaused && episodeActive) {
    scheduleStepLoop(getSpeedDelay());
  }
});

createGrid();
initQTable();
updateSpeedLabel();
syncChartHeight();
updateEpsilonDisplay();
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
