const gridElement = document.getElementById("grid");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const speedSlider = document.getElementById("speedSlider");
const speedLabel = document.getElementById("speedLabel");
const episodeCounter = document.getElementById("episodeCounter");
const currentScoreEl = document.getElementById("currentScore");
const bestScoreEl = document.getElementById("bestScore");

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

const chart = new Chart(document.getElementById("scoreChart"), {
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
  const level = Number(speedSlider.value);
  switch (level) {
    case 1:
      return 700;
    case 2:
      return 450;
    case 3:
      return 250;
    case 4:
      return 120;
    case 5:
      return 50;
    default:
      return 250;
  }
}

function updateSpeedLabel() {
  const level = Number(speedSlider.value);
  const labels = {
    1: "Långsam",
    2: "Mjuk",
    3: "Medium",
    4: "Snabb",
    5: "Turbo"
  };
  speedLabel.textContent = labels[level];
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
  robotSpan.style.position = "absolute";
  robotSpan.style.fontSize = "1.6rem";
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
    reward = 10;
    done = true;
  } else if (nextRow === hazardPos.row && nextCol === hazardPos.col) {
    reward = -10;
    done = true;
  }

  robotPos = { row: nextRow, col: nextCol };
  updateRobotVisual();

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
  updateRobotVisual();
  scheduleStepLoop(300);
}

function finalizeEpisode(score) {
  epsilon = Math.max(minEpsilon, epsilon * epsilonDecay);
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

  chart.update();

  if (score > bestScore) {
    bestScore = score;
    bestScoreEl.textContent = bestScore.toFixed(1);
  }
}

function startTraining() {
  if (isTraining && isPaused) {
    isPaused = false;
    if (episodeActive) {
      scheduleStepLoop(100);
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
}

function resetTraining() {
  isTraining = false;
  isPaused = false;
  episodeActive = false;
  clearTimeout(stepTimeout);
  clearTimeout(episodeTimeout);
  epsilon = 0.3;
  currentEpisode = 0;
  currentScore = 0;
  bestScore = -Infinity;
  scores = [];
  averages = [];
  chart.data.labels = [];
  chart.data.datasets[0].data = scores;
  chart.data.datasets[1].data = averages;
  chart.update();
  episodeCounter.textContent = "0";
  currentScoreEl.textContent = "0";
  bestScoreEl.textContent = "0";
  robotPos = { ...startPos };
  initQTable();
  createGrid();
}

startBtn.addEventListener("click", startTraining);
pauseBtn.addEventListener("click", pauseTraining);
resetBtn.addEventListener("click", resetTraining);

speedSlider.addEventListener("input", updateSpeedLabel);

createGrid();
initQTable();
updateSpeedLabel();
