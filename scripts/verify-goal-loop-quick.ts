import { handleChat } from "../src/api/chat";
import { agentManager } from "../src/core/agent";
import { config } from "../src/core/config";
import { resetGoalLoopsForTests, getGoalLoopState } from "../src/core/session-goal-loop";
import {
  getSessionGoal,
  handleSessionGoalCommand,
  resetSessionGoalsForTests,
  sessionGoalElapsedMs,
} from "../src/core/session-goals";

const INFERENCE_AGENT_ID = "8840cc4c-17f4-46d9-9b1b-13b9641ccf2f";
const SESSION_ID = "e2e-goal-quick";

resetSessionGoalsForTests();
resetGoalLoopsForTests();
config.set("goal_loop_max_iterations", 1);
config.set("goal_loop_max_duration_seconds", 60);

const agent = agentManager.get(INFERENCE_AGENT_ID);
if (!agent) {
  console.error("E2E FAIL: inference agent missing");
  process.exit(1);
}
console.log(`agent: ${agent.name} (${agent.model})`);

const started = handleSessionGoalCommand(SESSION_ID, "/goal start quick verify");
const startedGoal = getSessionGoal(SESSION_ID);
console.log(`start: ${started.response} status=${started.goal?.status}`);
console.log(`elapsed at start: ${startedGoal ? sessionGoalElapsedMs(startedGoal) : 0}ms`);

const turn = await handleChat({
  message: "reply briefly",
  sessionId: SESSION_ID,
  agentId: INFERENCE_AGENT_ID,
  tools: false,
});
console.log(`turn: ${(turn.message.content ?? "").slice(0, 90).replaceAll("\n", " ")}`);
console.log(`turn failure: ${turn.failure ?? "none"}`);
const goalAfterTurn = getSessionGoal(SESSION_ID);
console.log(`goal status after turn: ${goalAfterTurn?.status}`);

const paused = handleSessionGoalCommand(SESSION_ID, "/goal pause waiting");
const pausedGoal = getSessionGoal(SESSION_ID);
console.log(
  `pause: ${paused.response} activeMs=${pausedGoal?.activeMs} lastResumedAt=${pausedGoal?.lastResumedAt ?? "none"}`
);

const resumed = handleSessionGoalCommand(SESSION_ID, "/goal resume");
const resumedGoal = getSessionGoal(SESSION_ID);
console.log(`resume: ${resumed.response} status=${resumedGoal?.status}`);

const completed = handleSessionGoalCommand(SESSION_ID, "/goal complete verified");
console.log(`complete: ${completed.response}`);
console.log(`loop state after complete: ${JSON.stringify(getGoalLoopState(SESSION_ID))}`);

const passed =
  started.goal?.status === "active" &&
  turn.failure === undefined &&
  (turn.message.content ?? "").trim().length > 0 &&
  pausedGoal?.status === "paused" &&
  pausedGoal?.lastResumedAt === undefined &&
  resumedGoal?.status === "active" &&
  getGoalLoopState(SESSION_ID) === undefined;

console.log(passed ? "E2E PASS" : "E2E FAIL");
resetSessionGoalsForTests();
resetGoalLoopsForTests();
process.exit(passed ? 0 : 1);
